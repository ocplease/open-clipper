import { SavedClip } from '../types/types';
import browser from '../utils/browser-polyfill';
import { addBrowserClassToHtml } from '../utils/browser-detection';
import { prepareCurrentPageClip } from '../utils/clip-preparation';
import { copyToClipboard } from '../utils/clipboard-utils';
import { getMessage, setupLanguageAndDirection, translatePage } from '../utils/i18n';
import { initializeIcons } from '../icons/icons';
import { saveToObsidian } from '../utils/obsidian-note-creator';
import {
	addSavedClip,
	createSavedClipFromVariables,
	deleteSavedClip,
	hostnameFromUrl,
	listSavedClips
} from '../utils/saved-clips';
import { incrementStat, setLocalStorage } from '../utils/storage-utils';
import { isBlankPage, isRestrictedUrl, isValidUrl } from '../utils/active-tab-manager';
import { ClipFilter, composeSelectedMarkdown, filterSavedClips } from '../utils/clip-library';

let clips: SavedClip[] = [];
let selectedClipIds = new Set<string>();
let currentTabId: number | undefined;
let currentHostname = '';
let currentPageCanBeClipped = false;
let actionInProgress = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function element<T extends HTMLElement>(id: string): T {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing side-panel element: ${id}`);
	return value as T;
}

function setStatus(message: string, type: 'info' | 'success' | 'error' = 'info', clearAfter = 0): void {
	const status = element<HTMLDivElement>('library-status');
	if (statusTimer) clearTimeout(statusTimer);
	status.textContent = message;
	status.dataset.type = message ? type : '';
	if (clearAfter > 0) {
		statusTimer = setTimeout(() => setStatus(''), clearAfter);
	}
}

function formatClipDate(value: string): string {
	try {
		return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
			.format(new Date(value));
	} catch {
		return '';
	}
}

function updateActions(): void {
	const clipButton = element<HTMLButtonElement>('clip-current-page');
	const copyButton = element<HTMLButtonElement>('copy-selected-clips');
	clipButton.disabled = actionInProgress || !currentPageCanBeClipped;
	copyButton.disabled = actionInProgress || selectedClipIds.size === 0;
	element<HTMLSpanElement>('copy-selected-label').textContent = selectedClipIds.size > 0
		? getMessage('copySelectedCount', selectedClipIds.size.toString())
		: getMessage('copySelected');
}

function createCard(clip: SavedClip): HTMLElement {
	const card = document.createElement('article');
	card.className = 'clip-card';
	card.dataset.id = clip.id;
	card.classList.toggle('is-selected', selectedClipIds.has(clip.id));

	if (clip.imageUrl) {
		const media = document.createElement('div');
		media.className = 'clip-card-media';
		const image = document.createElement('img');
		image.src = clip.imageUrl;
		image.alt = '';
		image.loading = 'lazy';
		image.addEventListener('error', () => media.remove());
		media.appendChild(image);
		card.appendChild(media);
	}

	const selection = document.createElement('label');
	selection.className = 'clip-card-selection';
	selection.title = getMessage('selectClip');
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = selectedClipIds.has(clip.id);
	checkbox.setAttribute('aria-label', getMessage('selectClipNamed', clip.title));
	checkbox.addEventListener('change', () => {
		if (checkbox.checked) selectedClipIds.add(clip.id);
		else selectedClipIds.delete(clip.id);
		card.classList.toggle('is-selected', checkbox.checked);
		updateActions();
	});
	selection.appendChild(checkbox);
	card.appendChild(selection);

	const body = document.createElement('div');
	body.className = 'clip-card-body';
	const title = document.createElement('a');
	title.className = 'clip-card-title';
	title.href = clip.url;
	title.target = '_blank';
	title.rel = 'noreferrer';
	title.textContent = clip.title;
	title.title = clip.title;
	body.appendChild(title);

	if (clip.description) {
		const description = document.createElement('p');
		description.className = 'clip-card-description';
		description.textContent = clip.description;
		body.appendChild(description);
	}

	const meta = document.createElement('div');
	meta.className = 'clip-card-meta';
	const site = document.createElement('span');
	site.className = 'clip-card-site';
	if (clip.faviconUrl) {
		const favicon = document.createElement('img');
		favicon.src = clip.faviconUrl;
		favicon.alt = '';
		favicon.addEventListener('error', () => favicon.remove());
		site.appendChild(favicon);
	}
	const siteText = document.createElement('span');
	siteText.textContent = clip.site || hostnameFromUrl(clip.url);
	site.appendChild(siteText);
	meta.appendChild(site);

	const cardActions = document.createElement('span');
	cardActions.className = 'clip-card-actions';
	const date = document.createElement('time');
	date.dateTime = clip.createdAt;
	date.textContent = formatClipDate(clip.createdAt);
	cardActions.appendChild(date);
	const deleteButton = document.createElement('button');
	deleteButton.type = 'button';
	deleteButton.className = 'clickable-icon clip-delete';
	deleteButton.title = getMessage('deleteClip');
	deleteButton.setAttribute('aria-label', getMessage('deleteClipNamed', clip.title));
	deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
	deleteButton.addEventListener('click', () => void confirmDeleteClip(clip));
	cardActions.appendChild(deleteButton);
	meta.appendChild(cardActions);
	body.appendChild(meta);
	card.appendChild(body);
	return card;
}

function renderFeed(): void {
	const feed = element<HTMLElement>('clip-feed');
	const search = element<HTMLInputElement>('clip-search').value;
	const filter = element<HTMLSelectElement>('clip-filter').value as ClipFilter;
	const visibleClips = filterSavedClips(clips, search, filter, currentHostname);
	feed.textContent = '';

	if (visibleClips.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'clip-feed-empty';
		const icon = document.createElement('i');
		icon.setAttribute('data-lucide', 'archive');
		empty.appendChild(icon);
		const title = document.createElement('strong');
		title.textContent = clips.length === 0 ? getMessage('noSavedClips') : getMessage('noMatchingClips');
		empty.appendChild(title);
		const hint = document.createElement('span');
		hint.textContent = clips.length === 0 ? getMessage('noSavedClipsDescription') : getMessage('tryDifferentSearch');
		empty.appendChild(hint);
		feed.appendChild(empty);
	} else {
		visibleClips.forEach(clip => feed.appendChild(createCard(clip)));
	}

	initializeIcons(feed);
}

async function loadClips(): Promise<void> {
	try {
		clips = await listSavedClips();
		const existingIds = new Set(clips.map(clip => clip.id));
		selectedClipIds = new Set([...selectedClipIds].filter(id => existingIds.has(id)));
		renderFeed();
		updateActions();
	} catch (error) {
		console.error('Unable to load saved clips:', error);
		setStatus(getMessage('failedToLoadClips'), 'error');
	}
}

async function refreshActiveTab(tabId?: number, url?: string): Promise<void> {
	try {
		if (!tabId) {
			const response = await browser.runtime.sendMessage({ action: 'getActiveTab' }) as { tabId?: number; error?: string };
			if (!response?.tabId) throw new Error(response?.error || 'No active tab');
			tabId = response.tabId;
		}
		if (!url) {
			const response = await browser.runtime.sendMessage({ action: 'getTabInfo', tabId }) as {
				success?: boolean;
				tab?: { url?: string };
			};
			url = response?.tab?.url || '';
		}
		currentTabId = tabId;
		currentHostname = hostnameFromUrl(url);
		currentPageCanBeClipped = isValidUrl(url) && !isBlankPage(url) && !isRestrictedUrl(url);
	} catch {
		currentTabId = undefined;
		currentHostname = '';
		currentPageCanBeClipped = false;
	}
	element<HTMLSelectElement>('clip-filter').querySelector<HTMLOptionElement>('option[value="current-site"]')?.toggleAttribute('disabled', !currentHostname);
	updateActions();
	if (element<HTMLSelectElement>('clip-filter').value === 'current-site') renderFeed();
}

async function clipCurrentPage(): Promise<void> {
	if (!currentTabId || !currentPageCanBeClipped || actionInProgress) return;
	actionInProgress = true;
	updateActions();
	setStatus(getMessage('clippingCurrentPage'));
	try {
		const result = await prepareCurrentPageClip(currentTabId);
		if (result.requiresEditor) {
			const response = await browser.runtime.sendMessage({
				action: 'openClipperEditor',
				tabId: currentTabId
			}) as { success?: boolean; error?: string } | undefined;
			if (!response?.success) throw new Error(response?.error || 'Unable to open the clip editor');
			setStatus(getMessage('openedClipEditor'), 'info', 3000);
			return;
		}

		const prepared = result.clip;
		await saveToObsidian(
			prepared.fileContent,
			prepared.noteName,
			prepared.path,
			prepared.vault,
			prepared.template.behavior
		);
		await incrementStat('addToObsidian', prepared.vault, prepared.path, prepared.url, prepared.variables['{{title}}']);
		await setLocalStorage('lastSelectedVault', prepared.vault);

		try {
			await addSavedClip(createSavedClipFromVariables(
				prepared.fileContent,
				prepared.template,
				prepared.variables,
				prepared.vault,
				prepared.path
			));
			await loadClips();
			setStatus(getMessage('pageClipped'), 'success', 3000);
		} catch (archiveError) {
			console.error('Page saved to Obsidian but could not be archived:', archiveError);
			setStatus(getMessage('clipSavedArchiveFailed'), 'error');
		}
	} catch (error) {
		console.error('Unable to clip current page:', error);
		setStatus(getMessage('failedToClipCurrentPage'), 'error');
	} finally {
		actionInProgress = false;
		updateActions();
	}
}

async function copySelectedClips(): Promise<void> {
	if (selectedClipIds.size === 0 || actionInProgress) return;
	actionInProgress = true;
	updateActions();
	try {
		const markdown = composeSelectedMarkdown(clips, selectedClipIds);
		const success = await copyToClipboard(markdown);
		if (!success) throw new Error('Clipboard write failed');
		setStatus(getMessage('selectedClipsCopied', selectedClipIds.size.toString()), 'success', 3000);
	} catch (error) {
		console.error('Unable to copy selected clips:', error);
		setStatus(getMessage('failedToCopySelectedClips'), 'error');
	} finally {
		actionInProgress = false;
		updateActions();
	}
}

async function confirmDeleteClip(clip: SavedClip): Promise<void> {
	if (!window.confirm(getMessage('deleteClipConfirm', clip.title))) return;
	try {
		await deleteSavedClip(clip.id);
		selectedClipIds.delete(clip.id);
		await loadClips();
		setStatus(getMessage('clipDeleted'), 'success', 2500);
	} catch (error) {
		console.error('Unable to delete saved clip:', error);
		setStatus(getMessage('failedToDeleteClip'), 'error');
	}
}

function setupEvents(): void {
	element<HTMLInputElement>('clip-search').addEventListener('input', renderFeed);
	element<HTMLSelectElement>('clip-filter').addEventListener('change', renderFeed);
	element<HTMLButtonElement>('clip-current-page').addEventListener('click', () => void clipCurrentPage());
	element<HTMLButtonElement>('copy-selected-clips').addEventListener('click', () => void copySelectedClips());
	element<HTMLButtonElement>('library-settings').addEventListener('click', () => {
		void browser.runtime.sendMessage({ action: 'openOptionsPage' });
	});
	element<HTMLButtonElement>('library-close').addEventListener('click', () => window.close());

	browser.runtime.onMessage.addListener((request: unknown): undefined => {
		if (!request || typeof request !== 'object') return undefined;
		const message = request as { action?: string; tabId?: number; url?: string };
		if (message.action === 'savedClipsChanged') void loadClips();
		if (message.action === 'activeTabChanged') void refreshActiveTab(message.tabId, message.url);
		return undefined;
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	await translatePage();
	await setupLanguageAndDirection();
	await addBrowserClassToHtml();
	initializeIcons();
	element<HTMLButtonElement>('library-settings').setAttribute('aria-label', getMessage('settings'));
	element<HTMLButtonElement>('library-close').setAttribute('aria-label', getMessage('close'));
	element<HTMLSelectElement>('clip-filter').setAttribute('aria-label', getMessage('filterClips'));
	setupEvents();
	void browser.runtime.sendMessage({ action: 'sidePanelOpened' });
	window.addEventListener('beforeunload', () => {
		void browser.runtime.sendMessage({ action: 'sidePanelClosed' });
	});
	await Promise.all([loadClips(), refreshActiveTab()]);
});
