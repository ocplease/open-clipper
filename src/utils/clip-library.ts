import { SavedClip } from '../types/types';
import { hostnameFromUrl } from './saved-clips';

export type ClipFilter = 'all' | 'current-site';

export function filterSavedClips(
	allClips: SavedClip[],
	query: string,
	filter: ClipFilter,
	activeHostname: string
): SavedClip[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return allClips.filter(clip => {
		if (filter === 'current-site' && hostnameFromUrl(clip.url) !== activeHostname) return false;
		if (!normalizedQuery) return true;
		return [clip.title, clip.description, clip.site, clip.url]
			.some(value => value.toLocaleLowerCase().includes(normalizedQuery));
	});
}

export function composeSelectedMarkdown(allClips: SavedClip[], selectedIds: Set<string>): string {
	return allClips
		.filter(clip => selectedIds.has(clip.id))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map(clip => clip.markdown)
		.join('\n\n---\n\n');
}
