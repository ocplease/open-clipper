import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ImageInput {
  index: number;
  url: string;
  width?: number;
  height?: number;
}

interface DownloadedImage extends ImageInput {
  mimeType: string;
  data: Uint8Array;
}

interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

interface OcrWarning {
  stage: 'download' | 'gemini' | 'response';
  images: number[];
  code: string;
  message: string;
  retryable: boolean;
}

class GeminiBatchError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public quotaExceeded = false,
  ) {
    super(message);
  }
}

interface OcrModel {
  id: string;
  structuredOutput: boolean;
}

const DAILY_IMAGE_LIMIT = 30;
const MAX_REQUEST_CHARS = 120_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_BATCH_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_IMAGES = 4;
const OCR_MODELS: readonly OcrModel[] = [
  { id: 'gemini-3.1-flash-lite', structuredOutput: true },
  { id: 'gemma-4-31b-it', structuredOutput: false },
  { id: 'gemma-4-26b-a4b-it', structuredOutput: false },
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function isAllowedCdnUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (url.hostname === 'xhscdn.com' || url.hostname.endsWith('.xhscdn.com'));
  } catch {
    return false;
  }
}

function validateImages(value: unknown): ImageInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > DAILY_IMAGE_LIMIT) return null;
  const indexes = new Set<number>();
  const urls = new Set<string>();
  const images: ImageInput[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const input = item as Record<string, unknown>;
    const index = Number(input.index);
    const url = typeof input.url === 'string' ? input.url : '';
    if (!Number.isInteger(index) || index < 1 || index > DAILY_IMAGE_LIMIT || !isAllowedCdnUrl(url)) return null;
    if (indexes.has(index) || urls.has(url)) return null;
    indexes.add(index);
    urls.add(url);
    images.push({
      index,
      url,
      width: Number(input.width) || 0,
      height: Number(input.height) || 0,
    });
  }

  return images.sort((a, b) => a.index - b.index);
}

async function downloadImage(image: ImageInput): Promise<DownloadedImage> {
  const response = await fetch(image.url, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpenClipper/1.0)',
      Referer: 'https://www.xiaohongshu.com/',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Image ${image.index} returned HTTP ${response.status}`);
  if (response.status >= 300 && response.status < 400) throw new Error(`Image ${image.index} redirected`);

  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) throw new Error(`Image ${image.index} returned a non-image response`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error(`Image ${image.index} is too large`);

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) throw new Error(`Image ${image.index} is too large`);
  return { ...image, mimeType, data };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function createBatches(images: DownloadedImage[]): DownloadedImage[][] {
  const batches: DownloadedImage[][] = [];
  let batch: DownloadedImage[] = [];
  let batchBytes = 0;
  for (const image of images) {
    if (batch.length > 0 && (batch.length >= MAX_BATCH_IMAGES || batchBytes + image.data.byteLength > MAX_BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(image);
    batchBytes += image.data.byteLength;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function recognizeBatch(
  images: DownloadedImage[],
  apiKey: string,
  model: OcrModel,
): Promise<Map<number, string>> {
  const parts: Record<string, unknown>[] = [{
    text: [
      'Convert the visible text in each supplied image to faithful Markdown.',
      'Preserve the original language, reading order, headings, lists, tables, and code.',
      'Do not summarize, translate, caption decorative imagery, or invent missing text.',
      'Return one JSON item for every image index. Use an empty markdown string only when no text is visible.',
      'Return raw JSON only, with no Markdown code fence, in the shape {"images":[{"index":1,"markdown":"..."}]}.',
    ].join(' '),
  }];

  for (const image of images) {
    parts.push({ text: `The next image has index ${image.index}.` });
    parts.push({ inline_data: { mime_type: image.mimeType, data: toBase64(image.data) } });
  }

  let response: Response;
  try {
    const generationConfig: Record<string, unknown> = { temperature: 0 };
    if (model.structuredOutput) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = {
        type: 'OBJECT',
        properties: {
          images: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                index: { type: 'INTEGER' },
                markdown: { type: 'STRING' },
              },
              required: ['index', 'markdown'],
            },
          },
        },
        required: ['images'],
      };
    }

    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    throw new GeminiBatchError(
      isTimeout ? 'GEMINI_TIMEOUT' : 'GEMINI_NETWORK_ERROR',
      isTimeout ? `${model.id} did not respond within 90 seconds` : `Unable to reach ${model.id}`,
      true,
    );
  }

  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const providerCode = String(payload?.error?.status || `HTTP_${response.status}`).replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    const providerMessage = typeof payload?.error?.message === 'string'
      ? payload.error.message.slice(0, 500)
      : `${model.id} returned HTTP ${response.status}`;
    const quotaExceeded = response.status === 429
      || providerCode === 'RESOURCE_EXHAUSTED'
      || providerCode === 'QUOTA_EXCEEDED';
    throw new GeminiBatchError(
      `GEMINI_${providerCode}`,
      `${model.id}: ${providerMessage}`,
      quotaExceeded || response.status >= 500,
      quotaExceeded,
    );
  }
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
  if (!text) {
    const blockReason = payload?.promptFeedback?.blockReason;
    const finishReason = payload?.candidates?.[0]?.finishReason;
    const detail = blockReason || finishReason || 'no text candidate';
    throw new GeminiBatchError('GEMINI_EMPTY_RESPONSE', `${model.id} returned no text (${detail})`, false);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    throw new GeminiBatchError('GEMINI_INVALID_JSON', `${model.id} returned invalid JSON`, true);
  }
  const expected = new Set(images.map(image => image.index));
  const output = new Map<number, string>();
  for (const item of Array.isArray(parsed?.images) ? parsed.images : []) {
    const index = Number(item?.index);
    if (expected.has(index) && typeof item?.markdown === 'string' && !output.has(index)) {
      output.set(index, item.markdown.trim());
    }
  }
  return output;
}

async function recognizeBatchWithRetry(images: DownloadedImage[], apiKey: string): Promise<Map<number, string>> {
  let lastError: GeminiBatchError | null = null;
  for (const model of OCR_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await recognizeBatch(images, apiKey, model);
      } catch (error) {
        lastError = error instanceof GeminiBatchError
          ? error
          : new GeminiBatchError('GEMINI_UNKNOWN_ERROR', `Unexpected ${model.id} response-processing error`, false);
        if (lastError.quotaExceeded) break;
        if (!lastError.retryable || attempt === 2) throw lastError;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!lastError?.quotaExceeded) break;
  }
  throw lastError || new GeminiBatchError('GEMINI_UNKNOWN_ERROR', 'Unknown Gemini failure', false);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) return json({ error: 'Server is not configured' }, 500);

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return json({ error: 'Authentication required' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) return json({ error: 'Invalid authentication token' }, 401);

  const requestText = await request.text();
  if (requestText.length > MAX_REQUEST_CHARS) return json({ error: 'Request is too large' }, 413);
  let body: any;
  try {
    body = JSON.parse(requestText);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body?.noteId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.noteId)) {
    return json({ error: 'Invalid XHS note ID' }, 400);
  }
  const images = validateImages(body.images);
  if (!images) return json({ error: 'Invalid XHS image list' }, 400);

  const { data: quotaData, error: quotaError } = await admin.rpc('reserve_ocr_quota', {
    p_user_id: userData.user.id,
    p_image_count: images.length,
    p_limit: DAILY_IMAGE_LIMIT,
  });
  if (quotaError) return json({ error: 'Unable to reserve image quota' }, 500);
  const quota = quotaData as QuotaResult;
  if (!quota?.allowed) return json({ error: 'Daily image-recognition quota exceeded', quota }, 429);

  const downloads = await Promise.allSettled(images.map(downloadImage));
  const downloaded: DownloadedImage[] = [];
  const warnings: OcrWarning[] = [];
  downloads.forEach((result, position) => {
    if (result.status === 'fulfilled') downloaded.push(result.value);
    else warnings.push({
      stage: 'download',
      images: [images[position].index],
      code: 'IMAGE_DOWNLOAD_FAILED',
      message: result.reason instanceof Error ? result.reason.message.slice(0, 500) : 'Image download failed',
      retryable: true,
    });
  });
  if (downloaded.length === 0) return json({ error: 'No images could be downloaded', quota, warnings }, 502);

  const recognized = new Map<number, string>();
  const batches = createBatches(downloaded);
  let nextBatch = 0;
  const processBatches = async () => {
    while (nextBatch < batches.length) {
      const batch = batches[nextBatch++];
      try {
        const batchResult = await recognizeBatchWithRetry(batch, geminiApiKey);
        for (const [index, markdown] of batchResult) recognized.set(index, markdown);
        for (const image of batch) {
          if (!batchResult.has(image.index)) warnings.push({
            stage: 'response',
            images: [image.index],
            code: 'IMAGE_OMITTED',
            message: 'Gemini omitted this image from its structured response',
            retryable: true,
          });
        }
      } catch (error) {
        const detail = error instanceof GeminiBatchError
          ? error
          : new GeminiBatchError('GEMINI_UNKNOWN_ERROR', 'Unexpected Gemini failure', false);
        warnings.push({
          stage: 'gemini',
          images: batch.map(image => image.index),
          code: detail.code,
          message: detail.message.slice(0, 500),
          retryable: detail.retryable,
        });
      }
    }
  };
  await Promise.all([processBatches(), processBatches()]);
  if (recognized.size === 0) return json({ error: 'Gemini did not recognize any images', quota, warnings }, 502);

  const sections = Array.from(recognized.entries())
    .sort(([a], [b]) => a - b)
    .filter(([, markdown]) => markdown.length > 0)
    .map(([index, markdown]) => `### Image ${index}\n\n${markdown}`);
  const imageText = sections.length > 0 ? `## Text extracted from images\n\n${sections.join('\n\n')}` : '';

  return json({
    imageText,
    imagesProcessed: recognized.size,
    quota: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
    warnings: warnings.length > 0 ? warnings : undefined,
  });
});
