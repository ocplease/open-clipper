import { describe, expect, it } from 'vitest';
import { Template } from '../types/types';
import { createSavedClip, hostnameFromUrl } from './saved-clips';

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
});
