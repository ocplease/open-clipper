import browser from './browser-polyfill';
import { SavedClip, Template } from '../types/types';
import { getClipImageCandidates } from './clip-image';

const DATABASE_NAME = 'open-clipper-library';
const DATABASE_VERSION = 1;
const STORE_NAME = 'clips';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
	if (databasePromise) return databasePromise;

	databasePromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('createdAt', 'createdAt');
			}
		};
		request.onsuccess = () => {
			const database = request.result;
			database.onversionchange = () => {
				database.close();
				databasePromise = null;
			};
			resolve(database);
		};
		request.onerror = () => {
			databasePromise = null;
			reject(request.error || new Error('Unable to open the clip library'));
		};
		request.onblocked = () => {
			databasePromise = null;
			reject(new Error('The clip library is blocked by another extension page'));
		};
	});

	return databasePromise;
}

function runRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDatabase().then(database => new Promise<T>((resolve, reject) => {
		const transaction = database.transaction(STORE_NAME, mode);
		const request = operation(transaction.objectStore(STORE_NAME));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('Clip library operation failed'));
		transaction.onabort = () => reject(transaction.error || new Error('Clip library transaction was aborted'));
	}));
}

export async function listSavedClips(): Promise<SavedClip[]> {
	const clips = await runRequest<SavedClip[]>('readonly', store => store.getAll());
	return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addSavedClip(clip: SavedClip): Promise<void> {
	await runRequest<IDBValidKey>('readwrite', store => store.put(clip));
	await notifySavedClipsChanged();
}

/** Updates an existing saved clip and notifies any open library views. */
export async function updateSavedClip(clip: SavedClip): Promise<void> {
	await runRequest<IDBValidKey>('readwrite', store => store.put(clip));
	await notifySavedClipsChanged();
}

export async function deleteSavedClip(id: string): Promise<void> {
	await runRequest<undefined>('readwrite', store => store.delete(id));
	await notifySavedClipsChanged();
}

async function notifySavedClipsChanged(): Promise<void> {
	try {
		await browser.runtime.sendMessage({ action: 'savedClipsChanged' });
	} catch {
		// No listener is expected when the side panel is closed.
	}
}

function createId(): string {
	const cryptoWithUuid = globalThis.crypto as Crypto & { randomUUID?: () => string };
	return cryptoWithUuid?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface SavedClipSource {
	url: string;
	title?: string;
	description?: string;
	site?: string;
	author?: string;
	published?: string;
	faviconUrl?: string;
	imageUrl?: string;
	markdown: string;
	template: Template;
	vault?: string;
	path?: string;
}

export function createSavedClip(source: SavedClipSource): SavedClip {
	return {
		id: createId(),
		createdAt: new Date().toISOString(),
		url: source.url,
		title: source.title?.trim() || source.url,
		description: source.description?.trim() || '',
		site: source.site?.trim() || hostnameFromUrl(source.url),
		author: source.author?.trim() || '',
		published: source.published?.trim() || '',
		faviconUrl: source.faviconUrl || '',
		imageUrl: source.imageUrl || '',
		markdown: source.markdown,
		templateId: source.template.id,
		templateName: source.template.name,
		vault: source.vault || '',
		path: source.path || ''
	};
}

function getSchemaThumbnailCandidates(variables: Record<string, string>): string[] {
	return Object.entries(variables).flatMap(([key, value]) => {
		if (!/^\{\{schema:(?:.*[:.])?thumbnailUrl\}\}$/i.test(key) || !value?.trim()) return [];
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed.filter(item => typeof item === 'string');
			return typeof parsed === 'string' ? [parsed] : [];
		} catch {
			return [value];
		}
	});
}

export function createSavedClipFromVariables(
	markdown: string,
	template: Template,
	variables: Record<string, string>,
	vault: string,
	path: string
): SavedClip {
	const url = variables['{{url}}'] || '';
	const rawXhsPostImage = variables['{{xhsPostImage}}'];
	const xhsPostImage = rawXhsPostImage
		? getClipImageCandidates({ pageUrl: url, metadataImages: [rawXhsPostImage] })[0]
		: '';
	const imageUrl = xhsPostImage || getClipImageCandidates({
		pageUrl: url,
		metadataImages: [
			variables['{{image}}'],
			...getSchemaThumbnailCandidates(variables),
			variables['{{meta:property:og:image:secure_url}}'],
			variables['{{meta:property:og:image}}'],
			variables['{{meta:name:twitter:image}}'],
			variables['{{meta:property:twitter:image}}']
		],
		contentHtml: variables['{{contentHtml}}'],
		markdown
	})[0] || '';
	return createSavedClip({
		url,
		title: variables['{{title}}'],
		description: variables['{{description}}'],
		site: variables['{{site}}'],
		author: variables['{{author}}'],
		published: variables['{{published}}'],
		faviconUrl: variables['{{favicon}}'],
		imageUrl,
		markdown,
		template,
		vault,
		path
	});
}

export function hostnameFromUrl(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}
