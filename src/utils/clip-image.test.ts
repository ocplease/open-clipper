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

	it('uses the first image in Markdown before saved metadata and extracted HTML', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://example.com/articles/post',
			metadataImages: ['/images/metadata.jpg'],
			contentHtml: '<img src="/images/extracted.jpg">',
			markdown: [
				'---',
				'image: /images/frontmatter.jpg',
				'---',
				'<img src="/images/first.jpg">',
				'![Second](/images/second.jpg)'
			].join('\n')
		})).toEqual([
			'https://example.com/images/first.jpg',
			'https://example.com/images/second.jpg',
			'https://example.com/images/frontmatter.jpg',
			'https://example.com/images/metadata.jpg',
			'https://example.com/images/extracted.jpg'
		]);
	});

	it('skips YouTube video embeds and uses the thumbnail metadata', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://www.youtube.com/watch?v=abc123XYZ_0',
			metadataImages: ['https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg'],
			markdown: '![Video](https://www.youtube.com/watch?v=abc123XYZ_0)'
		})).toEqual([
			'https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg',
			'https://i.ytimg.com/vi/abc123XYZ_0/hqdefault.jpg'
		]);
	});

	it('derives a YouTube thumbnail when extraction provides no image', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://youtu.be/abc123XYZ_0',
			markdown: 'Video notes'
		})).toEqual(['https://i.ytimg.com/vi/abc123XYZ_0/hqdefault.jpg']);
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

	it('recovers Markdown images before frontmatter for existing clips', () => {
		const candidates = getSavedClipImageCandidates({
			url: 'https://example.com/post',
			imageUrl: '',
			markdown: '---\nimage: "/cover.jpg"\n---\n\n![Body](/body.jpg)'
		});
		expect(candidates).toEqual([
			'https://example.com/body.jpg',
			'https://example.com/cover.jpg'
		]);
	});

	it('removes duplicates and unsafe URL schemes', () => {
		expect(getClipImageCandidates({
			pageUrl: 'https://example.com/post',
			metadataImages: ['https://example.com/image.jpg', 'https://example.com/image.jpg', 'javascript:alert(1)']
		})).toEqual(['https://example.com/image.jpg']);
	});
});
