import { describe, expect, it } from 'vitest';
import { Template } from '../types/types';
import { createSavedClip, createSavedClipFromVariables, hostnameFromUrl } from './saved-clips';

const template: Template = {
	id: 'template-1',
	name: 'Default',
	behavior: 'create',
	noteNameFormat: '{{title}}',
	path: 'Clippings',
	noteContentFormat: '{{content}}',
	properties: []
};

describe('saved clip metadata', () => {
	it('normalizes hostnames for filtering and metadata fallbacks', () => {
		expect(hostnameFromUrl('https://www.Example.com/path')).toBe('example.com');
		const saved = createSavedClip({ url: 'https://example.com/page', markdown: 'body', template });
		expect(saved.title).toBe('https://example.com/page');
		expect(saved.site).toBe('example.com');
	});

	it('falls back to social metadata when the primary extracted image is empty', () => {
		const saved = createSavedClipFromVariables('body', template, {
			'{{url}}': 'https://example.com/article',
			'{{title}}': 'Article',
			'{{image}}': '',
			'{{meta:property:og:image}}': '/images/social.jpg'
		}, 'Notes', 'Clippings');
		expect(saved.imageUrl).toBe('https://example.com/images/social.jpg');
	});

	it('uses a schema.org thumbnail array for YouTube clips', () => {
		const saved = createSavedClipFromVariables(
			'![Video](https://www.youtube.com/watch?v=abc123XYZ_0)',
			template,
			{
				'{{url}}': 'https://www.youtube.com/watch?v=abc123XYZ_0',
				'{{title}}': 'Video',
				'{{image}}': '',
				'{{schema:thumbnailUrl}}': '["https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg"]'
			},
			'Notes',
			'Clippings'
		);
		expect(saved.imageUrl).toBe('https://i.ytimg.com/vi/abc123XYZ_0/maxresdefault.jpg');
	});
});
