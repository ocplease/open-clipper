import { SavedClip } from '../types/types';
import browser from '../utils/browser-polyfill';
import { addBrowserClassToHtml } from '../utils/browser-detection';
import {
	PreparedClip,
	prepareCurrentPageClip,
	updatePreparedClipImageText,
	updatePreparedClipXhsImages,
} from '../utils/clip-preparation';
import { copyToClipboard } from '../utils/clipboard-utils';
import { getMessage, setupLanguageAndDirection, translatePage } from '../utils/i18n';
import { initializeIcons } from '../icons/icons';
import { saveToObsidian } from '../utils/obsidian-note-creator';
import {
	addSavedClip,
	createSavedClipFromVariables,
	deleteSavedClip,
	hostnameFromUrl,
	listSavedClips,
	updateSavedClip
} from '../utils/saved-clips';
import { isBlankPage, isRestrictedUrl, isValidUrl } from '../utils/active-tab-manager';
import { ClipFilter, composeSelectedMarkdown, filterSavedClips } from '../utils/clip-library';
import { renderMarkdownPreview } from '../utils/markdown-preview';
import { getSavedClipImageCandidates } from '../utils/clip-image';
import { incrementStat, setLocalStorage } from '../utils/storage-utils';
import { XhsOcrResponse } from '../utils/supabase-ocr';
import { isXhsNoteUrl, XhsNoteImages } from '../utils/xhs-images';

let clips: SavedClip[] = [];
let selectedClipIds = new Set<string>();
let currentTabId: number | undefined;
let currentWindowId: number | undefined;
let currentHostname = '';
let currentPageCanBeClipped = false;
let actionInProgress = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let activeClipId: string | null = null;
let activeDetailTab: 'preview' | 'markdown' = 'preview';
let detailEditing = false;
let markdownBeforeEdit = '';
let feedFocusClipId: string | null = null;

function element<T extends HTMLElement>(id: string): T {
	const value = document.getElementById(id);
	if (!value) throw new Error(`Missing side-panel element: ${id}`);
	return value as T;
}

function setStatus(
	message: string,
	type: 'info' | 'success' | 'error' = 'info',
	clearAfter = 0,
	target: 'library-status' | 'detail-status' = activeClipId ? 'detail-status' : 'library-status'
): void {
	const status = element<HTMLDivElement>(target);
	if (statusTimer) clearTimeout(statusTimer);
	status.textContent = message;
	status.dataset.type = message ? type : '';
	if (clearAfter > 0) {
		statusTimer = setTimeout(() => setStatus('', 'info', 0, target), clearAfter);
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
	const saveButton = element<HTMLButtonElement>('save-selected-clips');
	const copyButton = element<HTMLButtonElement>('copy-selected-clips');
	clipButton.disabled = actionInProgress || !currentPageCanBeClipped;
	saveButton.disabled = actionInProgress || selectedClipIds.size === 0;
	copyButton.disabled = actionInProgress || selectedClipIds.size === 0;
	element<HTMLSpanElement>('copy-selected-label').textContent = selectedClipIds.size > 0
		? getMessage('copySelectedCount', selectedClipIds.size.toString())
		: getMessage('copySelected');
}

function getSelectedClips(): SavedClip[] {
	return clips
		.filter(clip => selectedClipIds.has(clip.id))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function loadClipImage(image: HTMLImageElement, candidates: string[], onExhausted: () => void): void {
	let candidateIndex = 0;
	image.referrerPolicy = 'no-referrer';
	image.decoding = 'async';
	image.onload = () => { image.hidden = false; };
	const tryNextCandidate = () => {
		const nextCandidate = candidates[candidateIndex++];
		if (nextCandidate) image.src = nextCandidate;
		else onExhausted();
	};
	image.onerror = tryNextCandidate;
	tryNextCandidate();
}

function createCard(clip: SavedClip): HTMLElement {
	const card = document.createElement('article');
	card.className = 'clip-card';
	card.dataset.id = clip.id;
	card.classList.toggle('is-selected', selectedClipIds.has(clip.id));
	const openButton = document.createElement('button');
	openButton.type = 'button';
	openButton.className = 'clip-card-open';
	openButton.setAttribute('aria-label', getMessage('viewClipNamed', clip.title));
	openButton.addEventListener('click', () => openClipDetail(clip.id));
	card.appendChild(openButton);

	const media = document.createElement('div');
	media.className = 'clip-card-media';
	const placeholder = document.createElement('i');
	placeholder.setAttribute('data-lucide', 'image');
	placeholder.setAttribute('aria-hidden', 'true');
	media.appendChild(placeholder);
	const imageCandidates = getSavedClipImageCandidates(clip);
	if (imageCandidates.length > 0) {
		const image = document.createElement('img');
		image.alt = '';
		image.loading = 'lazy';
		loadClipImage(image, imageCandidates, () => {
			image.remove();
			media.classList.add('is-placeholder');
		});
		media.appendChild(image);
	} else media.classList.add('is-placeholder');
	card.appendChild(media);

	const selection = document.createElement('label');
	selection.className = 'clip-card-selection';
	selection.title = getMessage('selectClip');
	selection.addEventListener('click', event => event.stopPropagation());
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
	const title = document.createElement('span');
	title.className = 'clip-card-title';
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
	deleteButton.addEventListener('click', event => {
		event.stopPropagation();
		void confirmDeleteClip(clip);
	});
	cardActions.appendChild(deleteButton);
	meta.appendChild(cardActions);
	body.appendChild(meta);
	card.appendChild(body);
	return card;
}

function getActiveClip(): SavedClip | undefined {
	return activeClipId ? clips.find(clip => clip.id === activeClipId) : undefined;
}

function setButtonContent(button: HTMLButtonElement, icon: string, label: string): void {
	button.replaceChildren();
	const iconElement = document.createElement('i');
	iconElement.setAttribute('data-lucide', icon);
	iconElement.setAttribute('aria-hidden', 'true');
	const labelElement = document.createElement('span');
	labelElement.textContent = label;
	button.append(iconElement, labelElement);
	initializeIcons(button);
}

function setDetailTab(tab: 'preview' | 'markdown', focusTab = false): void {
	if (detailEditing && tab === 'preview') return;
	activeDetailTab = tab;
	const previewTab = element<HTMLButtonElement>('clip-preview-tab');
	const markdownTab = element<HTMLButtonElement>('clip-markdown-tab');
	const previewPanel = element<HTMLDivElement>('clip-preview-panel');
	const markdownPanel = element<HTMLDivElement>('clip-markdown-panel');
	const previewActive = tab === 'preview';

	previewTab.setAttribute('aria-selected', previewActive.toString());
	previewTab.tabIndex = previewActive ? 0 : -1;
	markdownTab.setAttribute('aria-selected', (!previewActive).toString());
	markdownTab.tabIndex = previewActive ? -1 : 0;
	previewPanel.hidden = !previewActive;
	markdownPanel.hidden = previewActive;
	if (focusTab) (previewActive ? previewTab : markdownTab).focus();
}

function appendDetailMeta(container: HTMLElement, text: string): void {
	if (!text.trim()) return;
	const item = document.createElement('span');
	item.textContent = text;
	container.appendChild(item);
}

function renderClipDetail(): void {
	const clip = getActiveClip();
	if (!clip) return;

	const favicon = element<HTMLImageElement>('clip-detail-favicon');
	favicon.hidden = !clip.faviconUrl;
	if (clip.faviconUrl) {
		favicon.src = clip.faviconUrl;
		favicon.onerror = () => { favicon.hidden = true; };
	}
	element<HTMLSpanElement>('clip-detail-site-name').textContent = clip.site || hostnameFromUrl(clip.url);
	element<HTMLHeadingElement>('clip-detail-title').textContent = clip.title;
	element<HTMLAnchorElement>('clip-detail-source').href = clip.url;
	element<HTMLAnchorElement>('clip-detail-source').setAttribute('aria-label', getMessage('openSourceNamed', clip.title));

	const meta = element<HTMLDivElement>('clip-detail-meta');
	meta.replaceChildren();
	appendDetailMeta(meta, clip.author ? getMessage('byAuthor', clip.author) : '');
	appendDetailMeta(meta, formatClipDate(clip.published || clip.createdAt));
	appendDetailMeta(meta, clip.templateName);

	const media = element<HTMLDivElement>('clip-detail-media');
	const image = element<HTMLImageElement>('clip-detail-image');
	const imageCandidates = getSavedClipImageCandidates(clip);
	media.classList.toggle('is-placeholder', imageCandidates.length === 0);
	image.hidden = imageCandidates.length === 0;
	if (imageCandidates.length > 0) {
		image.alt = clip.title;
		loadClipImage(image, imageCandidates, () => {
			image.hidden = true;
			media.classList.add('is-placeholder');
		});
	}

	if (!detailEditing) element<HTMLTextAreaElement>('clip-markdown-field').value = clip.markdown;
	const preview = element<HTMLDivElement>('clip-preview-panel');
	try {
		preview.replaceChildren(renderMarkdownPreview(clip.markdown));
	} catch (error) {
		console.error('Unable to render Markdown preview:', error);
		preview.textContent = clip.markdown;
	}
	setDetailTab(activeDetailTab);
}

function openClipDetail(clipId: string): void {
	const clip = clips.find(candidate => candidate.id === clipId);
	if (!clip) return;
	feedFocusClipId = clipId;
	activeClipId = clipId;
	activeDetailTab = 'preview';
	detailEditing = false;
	markdownBeforeEdit = clip.markdown;
	element<HTMLElement>('library-view').hidden = true;
	element<HTMLElement>('clip-detail').hidden = false;
	setStatus('', 'info', 0, 'detail-status');
	element<HTMLButtonElement>('clip-preview-tab').disabled = false;
	element<HTMLTextAreaElement>('clip-markdown-field').readOnly = true;
	element<HTMLButtonElement>('cancel-clip-edit').hidden = true;
	setButtonContent(element<HTMLButtonElement>('edit-clip-markdown'), 'pen-line', getMessage('editMarkdown'));
	renderClipDetail();
	element<HTMLButtonElement>('clip-detail-back').focus();
}

function closeClipDetail(restoreFocus = true): void {
	const focusId = feedFocusClipId;
	detailEditing = false;
	activeClipId = null;
	element<HTMLElement>('clip-detail').hidden = true;
	element<HTMLElement>('library-view').hidden = false;
	if (restoreFocus && focusId) {
		requestAnimationFrame(() => {
			element<HTMLElement>('clip-feed')
				.querySelector<HTMLButtonElement>(`.clip-card[data-id="${CSS.escape(focusId)}"] .clip-card-open`)
				?.focus();
		});
	}
}

function beginDetailEdit(): void {
	const clip = getActiveClip();
	if (!clip || actionInProgress) return;
	detailEditing = true;
	markdownBeforeEdit = clip.markdown;
	setDetailTab('markdown');
	const field = element<HTMLTextAreaElement>('clip-markdown-field');
	field.readOnly = false;
	element<HTMLButtonElement>('clip-preview-tab').disabled = true;
	element<HTMLButtonElement>('cancel-clip-edit').hidden = false;
	setButtonContent(element<HTMLButtonElement>('edit-clip-markdown'), 'check', getMessage('saveChanges'));
	field.focus();
}

function cancelDetailEdit(): void {
	if (!detailEditing) return;
	detailEditing = false;
	const field = element<HTMLTextAreaElement>('clip-markdown-field');
	field.value = markdownBeforeEdit;
	field.readOnly = true;
	element<HTMLButtonElement>('clip-preview-tab').disabled = false;
	element<HTMLButtonElement>('cancel-clip-edit').hidden = true;
	setButtonContent(element<HTMLButtonElement>('edit-clip-markdown'), 'pen-line', getMessage('editMarkdown'));
	field.focus();
}

async function saveDetailEdit(): Promise<void> {
	const clip = getActiveClip();
	if (!clip || !detailEditing || actionInProgress) return;
	actionInProgress = true;
	const updatedClip = { ...clip, markdown: element<HTMLTextAreaElement>('clip-markdown-field').value };
	try {
		await updateSavedClip(updatedClip);
		clips = clips.map(candidate => candidate.id === updatedClip.id ? updatedClip : candidate);
		detailEditing = false;
		markdownBeforeEdit = updatedClip.markdown;
		element<HTMLTextAreaElement>('clip-markdown-field').readOnly = true;
		element<HTMLButtonElement>('clip-preview-tab').disabled = false;
		element<HTMLButtonElement>('cancel-clip-edit').hidden = true;
		setButtonContent(element<HTMLButtonElement>('edit-clip-markdown'), 'pen-line', getMessage('editMarkdown'));
		renderClipDetail();
		setStatus(getMessage('markdownSaved'), 'success', 2500, 'detail-status');
	} catch (error) {
		console.error('Unable to update saved clip:', error);
		setStatus(getMessage('failedToSaveMarkdown'), 'error', 0, 'detail-status');
	} finally {
		actionInProgress = false;
	}
}

async function copyDetailMarkdown(): Promise<void> {
	if (!activeClipId || actionInProgress) return;
	actionInProgress = true;
	try {
		const success = await copyToClipboard(element<HTMLTextAreaElement>('clip-markdown-field').value);
		if (!success) throw new Error('Clipboard write failed');
		setStatus(getMessage('markdownCopied'), 'success', 2500, 'detail-status');
	} catch (error) {
		console.error('Unable to copy clip Markdown:', error);
		setStatus(getMessage('failedToCopyMarkdown'), 'error', 0, 'detail-status');
	} finally {
		actionInProgress = false;
	}
}

async function deleteDetailClip(): Promise<void> {
	const clip = getActiveClip();
	if (!clip || !window.confirm(getMessage('deleteClipConfirm', clip.title))) return;
	try {
		await deleteSavedClip(clip.id);
		selectedClipIds.delete(clip.id);
		activeClipId = null;
		await loadClips();
		closeClipDetail(false);
		setStatus(getMessage('clipDeleted'), 'success', 2500, 'library-status');
	} catch (error) {
		console.error('Unable to delete saved clip:', error);
		setStatus(getMessage('failedToDeleteClip'), 'error', 0, 'detail-status');
	}
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
		const grid = document.createElement('div');
		grid.className = 'clip-feed-grid';
		visibleClips.forEach(clip => grid.appendChild(createCard(clip)));
		feed.appendChild(grid);
	}

	initializeIcons(feed);
}

async function loadClips(): Promise<void> {
	try {
		clips = await listSavedClips();
		const existingIds = new Set(clips.map(clip => clip.id));
		selectedClipIds = new Set([...selectedClipIds].filter(id => existingIds.has(id)));
		renderFeed();
		if (activeClipId && existingIds.has(activeClipId)) {
			renderClipDetail();
		} else if (activeClipId) {
			closeClipDetail(false);
			setStatus(getMessage('clipNoLongerAvailable'), 'info', 3000, 'library-status');
		}
		updateActions();
	} catch (error) {
		console.error('Unable to load saved clips:', error);
		setStatus(getMessage('failedToLoadClips'), 'error');
	}
}

async function refreshActiveTab(tabId?: number, url?: string, windowId?: number): Promise<void> {
	try {
		if (!tabId) {
			const response = await browser.runtime.sendMessage({
				action: 'getActiveTab',
				windowId: windowId ?? currentWindowId
			}) as {
				tabId?: number;
				windowId?: number;
				url?: string;
				error?: string;
			};
			if (!response?.tabId) throw new Error(response?.error || 'No active tab');
			tabId = response.tabId;
			windowId = response.windowId;
			url = response.url;
		}
		if (!url) {
			const response = await browser.runtime.sendMessage({ action: 'getTabInfo', tabId }) as {
				success?: boolean;
				tab?: { url?: string };
			};
			url = response?.tab?.url || '';
		}
		currentTabId = tabId;
		if (windowId !== undefined) currentWindowId = windowId;
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
	if (actionInProgress) return;
	actionInProgress = true;
	updateActions();
	try {
		// The side panel persists across tab changes, so cached tab state is never
		// authoritative for an explicit clip action.
		await refreshActiveTab();
		if (!currentTabId || !currentPageCanBeClipped) {
			setStatus(getMessage('activePageCannotBeClipped'), 'error', 3000);
			return;
		}
		setStatus(getMessage('clippingCurrentPage'));
		const result = await prepareCurrentPageClip(currentTabId);
		if (result.requiresEditor) {
			setStatus(getMessage('templateRequiresPromptInput'), 'error');
			return;
		}

		const prepared = result.clip;
		const savedClip = createSavedClipFromVariables(
			prepared.fileContent,
			prepared.template,
			prepared.variables,
			prepared.vault,
			prepared.path
		);
		await addSavedClip(savedClip);
		await loadClips();
		setStatus(getMessage('pageClipped'), 'success', 3000);
		if (prepared.deferredOcr || (process.env.TARGET_BROWSER === 'chrome' && isXhsNoteUrl(prepared.url))) {
			void completeDeferredOcr(savedClip, prepared);
		}
	} catch (error) {
		console.error('Unable to clip current page:', error);
		setStatus(getMessage('failedToClipCurrentPage'), 'error');
	} finally {
		actionInProgress = false;
		updateActions();
	}
}

async function completeDeferredOcr(savedClip: SavedClip, prepared: PreparedClip): Promise<void> {
	try {
		let preparedWithImages = prepared;
		if (!preparedWithImages.deferredOcr) {
			const discovery = await browser.runtime.sendMessage({
				action: 'sendMessageToTab',
				tabId: prepared.tabId,
				message: { action: 'getXhsMainImages', pageUrl: prepared.url },
			}) as { success?: boolean; xhsOcr?: XhsNoteImages | null; error?: string };
			if (discovery?.success === false) throw new Error(discovery.error || 'Unable to discover XHS images');
			if (!discovery?.xhsOcr) return;

			preparedWithImages = await updatePreparedClipXhsImages(prepared, discovery.xhsOcr);
			const imageUpdatedClip = createSavedClipFromVariables(
				preparedWithImages.fileContent,
				preparedWithImages.template,
				preparedWithImages.variables,
				preparedWithImages.vault,
				preparedWithImages.path,
			);
			await updateSavedClip({ ...imageUpdatedClip, id: savedClip.id, createdAt: savedClip.createdAt });
			await loadClips();
		}

		const deferredOcr = preparedWithImages.deferredOcr;
		if (!deferredOcr) return;
		const response = await browser.runtime.sendMessage({
			action: 'recognizeXhsImages',
			noteId: deferredOcr.noteId,
			images: deferredOcr.images,
		}) as XhsOcrResponse;
		if (!response.success) {
			if (response.warnings?.length) console.warn('[Open Clipper] XHS OCR diagnostics:', response.warnings);
			const diagnostic = response.warnings?.[0];
			throw new Error(diagnostic
				? `${response.error || 'Image recognition failed'}: ${diagnostic.code} — ${diagnostic.message}`
				: response.error || 'Image recognition failed');
		}

		const finalized = await updatePreparedClipImageText(preparedWithImages, response.imageText);
		const updated = createSavedClipFromVariables(
			finalized.fileContent,
			finalized.template,
			finalized.variables,
			finalized.vault,
			finalized.path,
		);
		await updateSavedClip({ ...updated, id: savedClip.id, createdAt: savedClip.createdAt });
		await loadClips();

		if (response.warnings?.length) {
			console.warn('[Open Clipper] XHS OCR completed with warnings:', response.warnings);
			setStatus(`Image text updated with ${response.warnings.length} warning(s).`, 'info', 5000);
		} else {
			setStatus('Image text added to the clip.', 'success', 3000);
		}
	} catch (error) {
		console.error('[Open Clipper] Unable to update clip with XHS image text:', error);
		setStatus(error instanceof Error ? error.message : 'Image recognition failed', 'error', 5000);
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

async function saveSelectedClipsToObsidian(): Promise<void> {
	if (selectedClipIds.size === 0 || actionInProgress) return;
	actionInProgress = true;
	updateActions();
	try {
		const selectedClips = getSelectedClips();
		if (selectedClips.length === 0) return;

		const primaryClip = selectedClips[0];
		const noteName = selectedClips.length === 1
			? primaryClip.title
			: getMessage('selectedClipsNoteName', selectedClips.length.toString());
		const markdown = composeSelectedMarkdown(clips, selectedClipIds);

		await saveToObsidian(markdown, noteName, primaryClip.path, primaryClip.vault, 'create');
		await incrementStat('addToObsidian', primaryClip.vault, primaryClip.path, primaryClip.url, noteName);
		if (primaryClip.vault) await setLocalStorage('lastSelectedVault', primaryClip.vault);
		setStatus(getMessage('selectedClipsAddedToObsidian', selectedClips.length.toString()), 'success', 3000);
	} catch (error) {
		console.error('Unable to add selected clips to Obsidian:', error);
		setStatus(getMessage('failedToAddSelectedClipsToObsidian'), 'error');
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
	element<HTMLButtonElement>('save-selected-clips').addEventListener('click', () => void saveSelectedClipsToObsidian());
	element<HTMLButtonElement>('copy-selected-clips').addEventListener('click', () => void copySelectedClips());
	element<HTMLButtonElement>('clip-detail-back').addEventListener('click', () => closeClipDetail());
	element<HTMLButtonElement>('clip-detail-close').addEventListener('click', () => closeClipDetail());
	element<HTMLButtonElement>('clip-preview-tab').addEventListener('click', () => setDetailTab('preview'));
	element<HTMLButtonElement>('clip-markdown-tab').addEventListener('click', () => setDetailTab('markdown'));
	element<HTMLButtonElement>('copy-clip-markdown').addEventListener('click', () => void copyDetailMarkdown());
	element<HTMLButtonElement>('edit-clip-markdown').addEventListener('click', () => {
		if (detailEditing) void saveDetailEdit();
		else beginDetailEdit();
	});
	element<HTMLButtonElement>('cancel-clip-edit').addEventListener('click', cancelDetailEdit);
	element<HTMLButtonElement>('delete-detail-clip').addEventListener('click', () => void deleteDetailClip());
	element<HTMLTextAreaElement>('clip-markdown-field').addEventListener('keydown', event => {
		if (event.key === 'Escape' && detailEditing) {
			event.preventDefault();
			cancelDetailEdit();
		}
		if (event.key === 'Enter' && detailEditing && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void saveDetailEdit();
		}
	});

	const detailTabs = [
		element<HTMLButtonElement>('clip-preview-tab'),
		element<HTMLButtonElement>('clip-markdown-tab')
	];
	detailTabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const next = detailTabs[(index + direction + detailTabs.length) % detailTabs.length];
		if (!next.disabled) setDetailTab(next.id === 'clip-preview-tab' ? 'preview' : 'markdown', true);
	}));

	browser.runtime.onMessage.addListener((request: unknown): undefined => {
		if (!request || typeof request !== 'object') return undefined;
		const message = request as { action?: string; tabId?: number; windowId?: number; url?: string };
		if (message.action === 'savedClipsChanged') void loadClips();
		if (message.action === 'activeTabChanged') {
			if (currentWindowId !== undefined && message.windowId !== undefined && message.windowId !== currentWindowId) {
				return undefined;
			}
			void refreshActiveTab(message.tabId, message.url, message.windowId);
		}
		if (message.action === 'triggerQuickClip') void clipCurrentPage();
		return undefined;
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	await translatePage();
	await setupLanguageAndDirection();
	await addBrowserClassToHtml();
	initializeIcons();
	element<HTMLSelectElement>('clip-filter').setAttribute('aria-label', getMessage('filterClips'));
	element<HTMLElement>('clip-detail-tabs').setAttribute('aria-label', getMessage('clipContent'));
	element<HTMLButtonElement>('clip-detail-close').setAttribute('aria-label', getMessage('closeClipDetails'));
	element<HTMLButtonElement>('delete-detail-clip').setAttribute('aria-label', getMessage('deleteClip'));
	setupEvents();
	await Promise.all([loadClips(), refreshActiveTab()]);
	void browser.runtime.sendMessage({ action: 'sidePanelOpened', windowId: currentWindowId });
	window.addEventListener('beforeunload', () => {
		void browser.runtime.sendMessage({ action: 'sidePanelClosed', windowId: currentWindowId });
	});
});
