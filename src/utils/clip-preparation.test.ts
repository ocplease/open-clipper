// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PreparedClip, updatePreparedClipImageText } from './clip-preparation';

describe('deferred XHS OCR clip updates', () => {
	test('recompiles an existing clip after image text arrives', async () => {
		const prepared: PreparedClip = {
			tabId: 1,
			url: 'https://www.xiaohongshu.com/explore/6a4cd4fc0000000006030b9b',
			template: {
				id: 'xhs-image-text-v1',
				name: 'Xiaohongshu note',
				behavior: 'create',
				noteNameFormat: '{{title}}',
				path: 'Clippings',
				noteContentFormat: '{{imageText}}\n\n{{content}}',
				properties: [],
			},
			variables: {
				'{{title}}': 'Example note',
				'{{content}}': 'Initial page text',
				'{{imageText}}': '',
			},
			fileContent: 'Initial page text\n\n',
			noteName: 'Example note',
			path: 'Clippings',
			vault: '',
		};

		const updated = await updatePreparedClipImageText(
			prepared,
			'## Text extracted from images\n\n### Image 1\n\nRecognized text',
		);

		expect(updated.fileContent).toContain('Initial page text');
		expect(updated.fileContent).toContain('### Image 1');
		expect(updated.fileContent).toContain('Recognized text');
		expect(updated.fileContent.indexOf('Text extracted from images'))
			.toBeLessThan(updated.fileContent.indexOf('Initial page text'));
		expect(updated.variables['{{imageText}}']).toContain('Text extracted from images');
		expect(prepared.variables['{{imageText}}']).toBe('');
	});
});
