import { SavedClip } from '../types/types';

export interface ClipImageSources {
	pageUrl: string;
	metadataImages?: Array<string | undefined>;
	contentHtml?: string;
	markdown?: string;
}

function getAttribute(tag: string, name: string): string {
	const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
	const match = tag.match(pattern);
	return match?.[1] || match?.[2] || match?.[3] || '';
}

function largestSrcsetUrl(srcset: string): string {
	const candidates = srcset
		.split(',')
		.map(candidate => candidate.trim().split(/\s+/)[0])
		.filter(Boolean);
	return candidates[candidates.length - 1] || '';
}

function isLikelyContentImage(tag: string, url: string): boolean {
	const descriptor = [
		getAttribute(tag, 'alt'),
		getAttribute(tag, 'class'),
		getAttribute(tag, 'id'),
		url
	].join(' ').toLocaleLowerCase();
	if (/(?:avatar|badge|emoji|icon|logo|pixel|spacer|tracking)/.test(descriptor)) return false;

	const width = Number.parseInt(getAttribute(tag, 'width'), 10);
	const height = Number.parseInt(getAttribute(tag, 'height'), 10);
	if (Number.isFinite(width) && Number.isFinite(height) && width < 160 && height < 160) return false;
	return true;
}

function extractHtmlImageCandidate(tag: string): string {
	const imageCandidates = [
		getAttribute(tag, 'data-original'),
		getAttribute(tag, 'data-src'),
		getAttribute(tag, 'data-lazy-src'),
		largestSrcsetUrl(getAttribute(tag, 'srcset') || getAttribute(tag, 'data-srcset')),
		getAttribute(tag, 'src')
	].filter(Boolean);
	return imageCandidates.find(candidate => isLikelyContentImage(tag, candidate)) || '';
}

function extractHtmlImageCandidates(html: string): string[] {
	if (!html) return [];
	const candidates: string[] = [];
	for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
		const preferred = extractHtmlImageCandidate(match[0]);
		if (preferred) candidates.push(preferred);
	}
	return candidates;
}

function extractFrontmatterImage(markdown: string): string {
	const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
	const match = frontmatter.match(/^(?:image|cover|thumbnail)\s*:\s*(.+?)\s*$/im);
	return match?.[1]?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2') || '';
}

function extractMarkdownImageCandidates(markdown: string): string[] {
	if (!markdown) return [];
	const candidates: string[] = [];
	const body = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
	const imagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)|(<img\b[^>]*>)/gi;
	for (const match of body.matchAll(imagePattern)) {
		const candidate = match[3]
			? extractHtmlImageCandidate(match[3])
			: match[1] || match[2];
		if (candidate) candidates.push(candidate);
	}
	const frontmatterImage = extractFrontmatterImage(markdown);
	if (frontmatterImage) candidates.push(frontmatterImage);
	return candidates;
}

function parseYouTubeVideoId(value: string, pageUrl?: string): string {
	try {
		const url = new URL(value, pageUrl);
		const hostname = url.hostname.toLocaleLowerCase().replace(/^(?:www\.|m\.)/, '');
		if (hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
		if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return '';
		if (url.pathname === '/watch') return url.searchParams.get('v') || '';
		const match = url.pathname.match(/^\/(?:embed|live|shorts)\/([^/?#]+)/);
		return match?.[1] || '';
	} catch {
		return '';
	}
}

function isYouTubeVideoUrl(value: string, pageUrl: string): boolean {
	return parseYouTubeVideoId(value, pageUrl) !== '';
}

function getYouTubeThumbnailUrl(pageUrl: string): string {
	const videoId = parseYouTubeVideoId(pageUrl);
	return /^[a-z\d_-]{6,}$/i.test(videoId)
		? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
		: '';
}

function normalizeImageUrl(value: string, pageUrl: string): string {
	let candidate = value.trim().replace(/&amp;/gi, '&');
	const markdownImage = candidate.match(/^!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/);
	if (markdownImage) candidate = markdownImage[1] || markdownImage[2];
	if (!candidate) return '';
	if (/^data:image\//i.test(candidate)) return candidate;

	try {
		const normalized = /^[a-z][a-z\d+.-]*:/i.test(candidate)
			? new URL(candidate)
			: new URL(candidate, pageUrl);
		return normalized.protocol === 'http:' || normalized.protocol === 'https:' ? normalized.href : '';
	} catch {
		return '';
	}
}

/** Returns normalized image URLs in fallback order, with duplicates removed. */
export function getClipImageCandidates(sources: ClipImageSources): string[] {
	const markdownCandidates = extractMarkdownImageCandidates(sources.markdown || '')
		.filter(candidate => !isYouTubeVideoUrl(candidate, sources.pageUrl));
	const rawCandidates = [
		...markdownCandidates,
		...(sources.metadataImages || []),
		...extractHtmlImageCandidates(sources.contentHtml || ''),
		getYouTubeThumbnailUrl(sources.pageUrl)
	];
	const candidates: string[] = [];
	const seen = new Set<string>();
	for (const value of rawCandidates) {
		if (!value) continue;
		const normalized = normalizeImageUrl(value, sources.pageUrl);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		candidates.push(normalized);
	}
	return candidates;
}

export function getSavedClipImageCandidates(
	clip: Pick<SavedClip, 'imageUrl' | 'markdown' | 'url'>
): string[] {
	return getClipImageCandidates({
		pageUrl: clip.url,
		metadataImages: [clip.imageUrl],
		markdown: clip.markdown
	});
}
