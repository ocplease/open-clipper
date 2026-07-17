// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import {
	createXhsPostExtractionDocument,
	extractXhsImagesFromState,
	extractXhsMainImages,
	extractXhsMainImagesFromDocument,
	normalizeInitialStateJson,
} from './xhs-images';

const NOTE_ID = '6a4cd4fc0000000006030b9b';
const PAGE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_source=pc_search`;

function image(index: number) {
	return {
		fileId: `main-${index}`,
		width: 1440,
		height: 2400,
		infoList: [
			{ imageScene: 'WB_PRV', url: `http://sns-webpic-qc.xhscdn.com/main-${index}-preview.jpg` },
			{ imageScene: 'WB_DFT', url: `http://sns-webpic-qc.xhscdn.com/main-${index}.jpg` },
		],
	};
}

function state(mainImageCount = 26, noteId = NOTE_ID) {
	return {
		note: {
			noteDetailMap: {
				[noteId]: {
					note: { noteId, imageList: Array.from({ length: mainImageCount }, (_, i) => image(i + 1)) },
					comments: {
						list: [{ images: [{ url: 'https://sns-webpic-qc.xhscdn.com/comment.jpg' }] }],
					},
				},
			},
		},
	};
}

function documentWithState(value: unknown): Document {
	return new DOMParser().parseFromString(
		`<html><body><img src="https://sns-webpic-qc.xhscdn.com/comment-dom.jpg"><script>window.__INITIAL_STATE__=${JSON.stringify(value)}</script></body></html>`,
		'text/html',
	);
}

describe('XHS main-note image extraction', () => {
	test('extracts all 26 main-note images in order and ignores comment/DOM images', async () => {
		const result = await extractXhsMainImages(documentWithState(state()), PAGE_URL);

		expect(result?.noteId).toBe(NOTE_ID);
		expect(result?.images).toHaveLength(26);
		expect(result?.images[0]).toMatchObject({
			index: 1,
			url: 'https://sns-webpic-qc.xhscdn.com/main-1.jpg',
		});
		expect(result?.images[25].index).toBe(26);
		expect(result?.images.some(item => item.url.includes('comment'))).toBe(false);
	});

	test('fails closed when the URL note ID does not match trusted page state', async () => {
		const fetchPage = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 }));
		const result = await extractXhsMainImages(
			documentWithState(state(2, 'aaaaaaaaaaaaaaaaaaaaaaaa')),
			PAGE_URL,
			fetchPage,
		);

		expect(result).toBeNull();
		expect(fetchPage).toHaveBeenCalledOnce();
	});

	test('uses fetched current-route state after an SPA navigation', async () => {
		const fetched = documentWithState(state(3)).documentElement.outerHTML;
		const fetchPage = vi.fn().mockResolvedValue(new Response(fetched, { status: 200 }));
		const emptyDocument = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');

		const result = await extractXhsMainImages(emptyDocument, PAGE_URL, fetchPage);

		expect(result?.images).toHaveLength(3);
		expect(fetchPage).toHaveBeenCalledWith(PAGE_URL, { credentials: 'include' });
	});

	test('can inspect embedded state without starting the fallback page fetch', () => {
		const emptyDocument = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');

		expect(extractXhsMainImagesFromDocument(emptyDocument, PAGE_URL)).toBeNull();
		expect(extractXhsMainImagesFromDocument(documentWithState(state(2)), PAGE_URL)?.images).toHaveLength(2);
	});

	test('scopes feed-modal extraction to the current post', () => {
		const doc = new DOMParser().parseFromString(`
			<html><body>
				<main class="feeds-page"><img src="https://sns-webpic-qc.xhscdn.com/other-post.jpg"></main>
				<div class="note-detail-mask">
					<div class="note-container">
						<div class="media-container"><img src="https://sns-webpic-qc.xhscdn.com/current-post.jpg"></div>
						<div class="note-content"><h1>Current post</h1><p>Current post body</p></div>
						<div class="comments-container"><img src="https://sns-webpic-qc.xhscdn.com/comment.jpg"></div>
					</div>
				</div>
			</body></html>
		`, 'text/html');

		const scoped = createXhsPostExtractionDocument(doc, PAGE_URL);

		expect(scoped.body.textContent).toContain('Current post body');
		expect(scoped.body.innerHTML).toContain('current-post.jpg');
		expect(scoped.body.innerHTML).not.toContain('other-post.jpg');
		expect(scoped.body.innerHTML).not.toContain('comment.jpg');
	});

	test('rejects untrusted image hosts and deduplicates file IDs', () => {
		const value = state(2);
		const list = value.note.noteDetailMap[NOTE_ID].note.imageList;
		list[1].fileId = list[0].fileId;
		list.push({
			...image(3),
			fileId: 'untrusted',
			infoList: [{ imageScene: 'WB_DFT', url: 'https://example.com/not-xhs.jpg' }],
		});

		const result = extractXhsImagesFromState(value, NOTE_ID);
		expect(result?.images).toHaveLength(1);
	});

	test('normalizes bare undefined without changing string contents', () => {
		const normalized = normalizeInitialStateJson('{"literal":"undefined","value":undefined,"items":[undefined]}');
		expect(JSON.parse(normalized)).toEqual({ literal: 'undefined', value: null, items: [null] });
	});
});
