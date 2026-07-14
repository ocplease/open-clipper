// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdownPreview } from './markdown-preview';

describe('renderMarkdownPreview', () => {
	it('renders common Markdown structures', () => {
		const container = document.createElement('div');
		container.appendChild(renderMarkdownPreview('# Heading\n\n- one\n- two\n\n[Link](https://example.com)'));

		expect(container.querySelector('h1')?.textContent).toBe('Heading');
		expect(container.querySelectorAll('li')).toHaveLength(2);
		expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
		expect(container.querySelector('a')?.target).toBe('_blank');
		expect(container.querySelector('a')?.rel).toBe('noreferrer');
	});

	it('removes executable HTML from archived Markdown', () => {
		const container = document.createElement('div');
		container.appendChild(renderMarkdownPreview('<script>alert(1)</script><img src="x" onerror="alert(2)">'));

		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')?.hasAttribute('onerror')).toBe(false);
	});
});
