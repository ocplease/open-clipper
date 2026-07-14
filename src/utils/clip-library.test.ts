import { describe, expect, it } from 'vitest';
import { SavedClip } from '../types/types';
import { composeSelectedMarkdown, filterSavedClips } from './clip-library';

function clip(overrides: Partial<SavedClip>): SavedClip {
	return {
		id: 'clip-1',
		createdAt: '2026-07-14T08:00:00.000Z',
		url: 'https://example.com/article',
		title: 'Designing calm apps',
		description: 'Patterns for focused product experiences',
		site: 'Example',
		author: '',
		published: '',
		faviconUrl: '',
		imageUrl: '',
		markdown: '# Calm apps',
		templateId: 'template-1',
		templateName: 'Default',
		vault: 'Notes',
		path: 'Clippings',
		...overrides
	};
}

describe('filterSavedClips', () => {
	const clips = [
		clip({ id: 'one' }),
		clip({ id: 'two', url: 'https://other.test/post', title: 'Travel guide', site: 'Other' })
	];

	it('searches title, description, site, and URL without case sensitivity', () => {
		expect(filterSavedClips(clips, 'CALM', 'all', '')).toEqual([clips[0]]);
		expect(filterSavedClips(clips, 'other.test', 'all', '')).toEqual([clips[1]]);
	});

	it('limits results to the normalized active hostname', () => {
		expect(filterSavedClips(clips, '', 'current-site', 'example.com')).toEqual([clips[0]]);
	});
});

describe('composeSelectedMarkdown', () => {
	it('copies selected records newest first with document separators', () => {
		const older = clip({ id: 'older', createdAt: '2026-07-13T08:00:00.000Z', markdown: 'older' });
		const newer = clip({ id: 'newer', createdAt: '2026-07-14T08:00:00.000Z', markdown: 'newer' });
		expect(composeSelectedMarkdown([older, newer], new Set(['older', 'newer'])))
			.toBe('newer\n\n---\n\nolder');
	});
});
