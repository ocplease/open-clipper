import { createClient, SupabaseClient } from '@supabase/supabase-js';
import browser from './browser-polyfill';
import { XhsImageReference } from './xhs-images';

export interface XhsOcrResponse {
	success: boolean;
	imageText: string;
	imagesProcessed: number;
	quota?: { used: number; limit: number; remaining: number };
	warnings?: XhsOcrWarning[];
	error?: string;
}

export interface XhsOcrWarning {
	stage: 'download' | 'gemini' | 'response';
	images: number[];
	code: string;
	message: string;
	retryable: boolean;
}

const STORAGE_PREFIX = 'supabase-auth:';
let client: SupabaseClient | null = null;

const extensionStorage = {
	async getItem(key: string): Promise<string | null> {
		const result = await browser.storage.local.get(STORAGE_PREFIX + key);
		const value = result[STORAGE_PREFIX + key];
		return typeof value === 'string' ? value : null;
	},
	async setItem(key: string, value: string): Promise<void> {
		await browser.storage.local.set({ [STORAGE_PREFIX + key]: value });
	},
	async removeItem(key: string): Promise<void> {
		await browser.storage.local.remove(STORAGE_PREFIX + key);
	},
};

function getClient(): SupabaseClient {
	if (client) return client;
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !publishableKey) throw new Error('Image recognition is not configured');
	client = createClient(url, publishableKey, {
		auth: {
			storage: extensionStorage,
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
	});
	return client;
}

async function getAccessToken(): Promise<string> {
	const supabase = getClient();
	let { data: { session }, error } = await supabase.auth.getSession();
	if (error) throw error;

	if (session && session.expires_at && session.expires_at * 1000 < Date.now() + 60_000) {
		const refreshed = await supabase.auth.refreshSession();
		if (refreshed.error) throw refreshed.error;
		session = refreshed.data.session;
	}

	if (!session) {
		const signedIn = await supabase.auth.signInAnonymously();
		if (signedIn.error) throw signedIn.error;
		session = signedIn.data.session;
	}

	if (!session?.access_token) throw new Error('Unable to create an anonymous image-recognition session');
	return session.access_token;
}

export async function recognizeXhsImages(noteId: string, images: XhsImageReference[]): Promise<XhsOcrResponse> {
	if (process.env.TARGET_BROWSER !== 'chrome') {
		return { success: false, imageText: '', imagesProcessed: 0, error: 'Image recognition is currently supported on Chrome only' };
	}
	if (!/^[a-f0-9]{24}$/i.test(noteId) || images.length < 1 || images.length > 30) {
		return { success: false, imageText: '', imagesProcessed: 0, error: 'Invalid XHS image-recognition request' };
	}

	try {
		const accessToken = await getAccessToken();
		const { data, error } = await getClient().functions.invoke('recognize-xhs-images', {
			body: { noteId, images },
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (error) throw error;
		if (!data || typeof data.imageText !== 'string') throw new Error('Invalid image-recognition response');
		return {
			success: true,
			imageText: data.imageText,
			imagesProcessed: Number(data.imagesProcessed) || 0,
			quota: data.quota,
			warnings: Array.isArray(data.warnings) ? data.warnings : undefined,
		};
	} catch (error) {
		let details: any = null;
		const context = (error as any)?.context;
		if (context && typeof context.clone === 'function') {
			try {
				details = await context.clone().json();
			} catch {
				// A non-JSON gateway error has no safe structured details to expose.
			}
		}
		return {
			success: false,
			imageText: '',
			imagesProcessed: 0,
			quota: details?.quota,
			warnings: Array.isArray(details?.warnings) ? details.warnings : undefined,
			error: typeof details?.error === 'string'
				? details.error
				: error instanceof Error ? error.message : String(error),
		};
	}
}
