import { describe, expect, it } from 'vitest';
import { getClipImageCandidates, getSavedClipImageCandidates } from './clip-image';

describe('getClipImageCandidates', () => {
	it('prioritizes metadata images and resolves relative URLs', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://example.com/articles/post',
			metadataImages: ['/images/cover.jpg'],
			contentHtml: '<img src="https://example.com/body.jpg">'
		})).toEqual([
			'https://example.com/images/cover.jpg',
			'https://example.com/body.jpg'
		]);
	});

	it('skips obvious decorative images and prefers a high-resolution article image', () => {
		const candidates = getClipImageCandidates({
			pageUrl: 'https://example.com/post',
			contentHtml: [
				'<img class="site-logo" width="40" height="40" src="/logo.png">',
				'<img alt="Article cover" src="/small.jpg" srcset="/medium.jpg 640w, /large.jpg 1280w">'
			].join('')
		});
		expect(candidates).toEqual(['https://example.com/large.jpg']);
	});

	it('recovers images from frontmatter and Markdown for existing clips', () => {
		const candidates = getSavedClipImageCandidates({
			url: 'https://example.com/post',
			imageUrl: '',
			markdown: '---\nimage: "/cover.jpg"\n---\n\n![Body](/body.jpg)'
		});
		expect(candidates).toEqual([
			'https://example.com/cover.jpg',
			'https://example.com/body.jpg'
		]);
	});

	it('removes duplicates and unsafe URL schemes', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://example.com/post',
			metadataImages: ['https://example.com/image.jpg', 'https://example.com/image.jpg', 'javascript:alert(1)']
		})).toEqual(['https://example.com/image.jpg']);
	});
});
