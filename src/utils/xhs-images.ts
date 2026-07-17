export interface XhsImageReference {
	index: number;
	url: string;
	width: number;
	height: number;
}

export interface XhsNoteImages {
	noteId: string;
	images: XhsImageReference[];
}

const INITIAL_STATE_MARKER = 'window.__INITIAL_STATE__=';
const MAX_IMAGES = 30;

function getNoteId(pageUrl: string): string | null {
	try {
		const url = new URL(pageUrl);
		if (url.hostname !== 'www.xiaohongshu.com' && url.hostname !== 'xiaohongshu.com') return null;
		return url.pathname.match(/^\/explore\/([a-f0-9]{24})(?:\/|$)/i)?.[1] || null;
	} catch {
		return null;
	}
}

export function isXhsNoteUrl(pageUrl: string): boolean {
	return getNoteId(pageUrl) !== null;
}

/**
 * XHS opens notes from the feed as an SPA modal while leaving the entire feed
 * mounted behind it. Give article extraction a document containing only the
 * active note so feed cards and comments cannot leak into the clipped content.
 */
export function createXhsPostExtractionDocument(doc: Document, pageUrl: string): Document {
	if (!isXhsNoteUrl(pageUrl)) return doc;
	const activeNote = doc.querySelector('.note-detail-mask .note-container');
	if (!activeNote) return doc;

	const scoped = doc.implementation.createHTMLDocument(doc.title);
	scoped.documentElement.lang = doc.documentElement.lang;
	const base = scoped.createElement('base');
	base.href = pageUrl;
	scoped.head.appendChild(base);

	const article = scoped.createElement('article');
	article.appendChild(activeNote.cloneNode(true));
	article.querySelectorAll('.comments-container').forEach(element => element.remove());
	scoped.body.appendChild(article);
	return scoped;
}

// XHS serializes a JavaScript object rather than strict JSON and occasionally
// uses bare `undefined` values. Normalize those tokens without touching strings;
// never evaluate page-owned JavaScript.
export function normalizeInitialStateJson(value: string): string {
	let output = '';
	let inString = false;
	let escaped = false;

	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (inString) {
			output += char;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}

		if (char === '"') {
			inString = true;
			output += char;
			continue;
		}

		if (value.startsWith('undefined', i)) {
			const before = value[i - 1];
			const after = value[i + 'undefined'.length];
			const boundaryBefore = !before || /[\s:[,{]/.test(before);
			const boundaryAfter = !after || /[\s,}\]]/.test(after);
			if (boundaryBefore && boundaryAfter) {
				output += 'null';
				i += 'undefined'.length - 1;
				continue;
			}
		}

		output += char;
	}

	return output;
}

function parseStateScript(scriptText: string): unknown | null {
	const markerIndex = scriptText.indexOf(INITIAL_STATE_MARKER);
	if (markerIndex < 0) return null;
	let json = scriptText.slice(markerIndex + INITIAL_STATE_MARKER.length).trim();
	if (json.endsWith(';')) json = json.slice(0, -1).trim();
	try {
		return JSON.parse(normalizeInitialStateJson(json));
	} catch {
		return null;
	}
}

function isAllowedImageUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl.replace(/^http:/, 'https:'));
		return url.protocol === 'https:' && (url.hostname === 'xhscdn.com' || url.hostname.endsWith('.xhscdn.com'));
	} catch {
		return false;
	}
}

export function extractXhsImagesFromState(state: any, noteId: string): XhsNoteImages | null {
	const detail = state?.note?.noteDetailMap?.[noteId];
	const note = detail?.note;
	if (!note || note.noteId !== noteId || !Array.isArray(note.imageList)) return null;

	const seen = new Set<string>();
	const images: XhsImageReference[] = [];
	for (const image of note.imageList) {
		if (images.length >= MAX_IMAGES) break;
		if (!image || typeof image !== 'object') continue;
		const identity = typeof image.fileId === 'string' && image.fileId ? image.fileId : JSON.stringify(image.infoList);
		if (!identity || seen.has(identity) || !Array.isArray(image.infoList)) continue;

		const preferred = image.infoList.find((item: any) => item?.imageScene === 'WB_DFT' && typeof item.url === 'string')
			|| image.infoList.find((item: any) => item?.imageScene === 'WB_PRV' && typeof item.url === 'string');
		if (!preferred || !isAllowedImageUrl(preferred.url)) continue;

		seen.add(identity);
		images.push({
			index: images.length + 1,
			url: preferred.url.replace(/^http:/, 'https:'),
			width: Number.isFinite(Number(image.width)) ? Number(image.width) : 0,
			height: Number.isFinite(Number(image.height)) ? Number(image.height) : 0,
		});
	}

	return images.length > 0 ? { noteId, images } : null;
}

function extractFromDocument(doc: Document, noteId: string): XhsNoteImages | null {
	for (const script of Array.from(doc.scripts)) {
		if (!script.textContent?.includes(INITIAL_STATE_MARKER)) continue;
		const state = parseStateScript(script.textContent);
		const result = extractXhsImagesFromState(state, noteId);
		if (result) return result;
	}
	return null;
}

export function extractXhsMainImagesFromDocument(doc: Document, pageUrl: string): XhsNoteImages | null {
	const noteId = getNoteId(pageUrl);
	return noteId ? extractFromDocument(doc, noteId) : null;
}

export async function extractXhsMainImages(
	doc: Document,
	pageUrl: string,
	fetchPage: typeof fetch = fetch,
): Promise<XhsNoteImages | null> {
	const noteId = getNoteId(pageUrl);
	if (!noteId) return null;

	const currentState = extractXhsMainImagesFromDocument(doc, pageUrl);
	if (currentState) return currentState;

	try {
		const response = await fetchPage(pageUrl, { credentials: 'include' });
		if (!response.ok) return null;
		const html = await response.text();
		const fetchedDocument = new DOMParser().parseFromString(html, 'text/html');
		return extractFromDocument(fetchedDocument, noteId);
	} catch {
		return null;
	}
}
