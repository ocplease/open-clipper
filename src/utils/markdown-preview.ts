import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** Converts archived Markdown to a sanitized DOM fragment for local preview. */
export function renderMarkdownPreview(markdown: string): DocumentFragment {
	const html = marked.parse(markdown, { async: false }) as string;
	const fragment = DOMPurify.sanitize(html, {
		RETURN_DOM_FRAGMENT: true,
		USE_PROFILES: { html: true }
	});
	fragment.querySelectorAll('a').forEach(link => {
		link.target = '_blank';
		link.rel = 'noreferrer';
	});
	return fragment;
}
