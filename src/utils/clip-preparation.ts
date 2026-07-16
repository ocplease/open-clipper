import { Property, Template } from '../types/types';
import { loadTemplates } from '../managers/template-manager';
import { extractPageContent, initializePageContent } from './content-extractor';
import { collectPromptVariables } from './interpreter';
import { generateFrontmatter } from './obsidian-note-creator';
import { compileTemplate } from './template-compiler';
import { findMatchingTemplate, initializeTriggers } from './triggers';
import { formatPropertyValue } from './shared';
import { getLocalStorage, loadSettings, Settings } from './storage-utils';
import { unescapeValue } from './string-utils';
import browser from './browser-polyfill';
import { XhsNoteImages } from './xhs-images';

export interface PreparedClip {
	tabId: number;
	url: string;
	template: Template;
	variables: Record<string, string>;
	fileContent: string;
	noteName: string;
	path: string;
	vault: string;
	deferredOcr?: XhsNoteImages;
}

export type ClipPreparationResult =
	| { requiresEditor: true; template: Template }
	| { requiresEditor: false; clip: PreparedClip };

async function getTabUrl(tabId: number): Promise<string> {
	const response = await browser.runtime.sendMessage({ action: 'getTabInfo', tabId }) as {
		success?: boolean;
		tab?: { url?: string };
		error?: string;
	};
	if (!response?.success || !response.tab?.url) {
		throw new Error(response?.error || 'Unable to read the current tab');
	}
	return response.tab.url;
}

function chooseVault(template: Template, settings: Settings, rememberedVault: string | null): string {
	return template.vault || rememberedVault || settings.vaults[0] || '';
}

export async function prepareCurrentPageClip(tabId: number): Promise<ClipPreparationResult> {
	const [settings, templates, url, rememberedVault] = await Promise.all([
		loadSettings(),
		loadTemplates(),
		getTabUrl(tabId),
		getLocalStorage('lastSelectedVault') as Promise<string | null>
	]);

	if (templates.length === 0) throw new Error('No clipping templates are available');
	initializeTriggers(templates);

	const extractionPromise = extractPageContent(tabId);
	const template = await findMatchingTemplate(url, async () => (await extractionPromise)?.schemaOrgData) || templates[0];
	if (collectPromptVariables(template).length > 0) {
		return { requiresEditor: true, template };
	}

	const extracted = await extractionPromise;
	if (!extracted) throw new Error('Unable to extract the current page');

	const initialized = await initializePageContent(
		extracted.content,
		extracted.selectedHtml,
		extracted.extractedContent,
		url,
		extracted.schemaOrgData,
		extracted.fullHtml,
		extracted.highlights || [],
		extracted.title,
		extracted.author,
		extracted.description,
		extracted.favicon,
		extracted.image,
		extracted.published,
		extracted.site,
		extracted.wordCount,
		extracted.language || '',
		extracted.metaTags
	);
	if (!initialized) throw new Error('Unable to prepare the current page');

	const typeMap = new Map(settings.propertyTypes.map(type => [type.name, type.type]));
	const [compiledProperties, noteName, path, noteContent] = await Promise.all([
		Promise.all(template.properties.map(async property => {
			const compiled = await compileTemplate(tabId, unescapeValue(property.value), initialized.currentVariables, url);
			return {
				...property,
				value: formatPropertyValue(compiled, typeMap.get(property.name) || 'text', property.value)
			} as Property;
		})),
		compileTemplate(tabId, template.noteNameFormat, initialized.currentVariables, url),
		compileTemplate(tabId, template.path, initialized.currentVariables, url),
		template.noteContentFormat
			? compileTemplate(tabId, template.noteContentFormat, initialized.currentVariables, url)
			: Promise.resolve('')
	]);

	return {
		requiresEditor: false,
		clip: {
			tabId,
			url,
			template,
			variables: initialized.currentVariables,
			fileContent: await generateFrontmatter(compiledProperties) + noteContent,
			noteName: noteName.trim(),
			path,
			vault: chooseVault(template, settings, rememberedVault),
			deferredOcr: extracted.xhsOcr
		}
	};
}

export async function updatePreparedClipImageText(prepared: PreparedClip, imageText: string): Promise<PreparedClip> {
	const settings = await loadSettings();
	const variables = { ...prepared.variables, '{{imageText}}': imageText };
	const typeMap = new Map(settings.propertyTypes.map(type => [type.name, type.type]));
	const [compiledProperties, noteName, path, noteContent] = await Promise.all([
		Promise.all(prepared.template.properties.map(async property => {
			const compiled = await compileTemplate(prepared.tabId, unescapeValue(property.value), variables, prepared.url);
			return {
				...property,
				value: formatPropertyValue(compiled, typeMap.get(property.name) || 'text', property.value)
			} as Property;
		})),
		compileTemplate(prepared.tabId, prepared.template.noteNameFormat, variables, prepared.url),
		compileTemplate(prepared.tabId, prepared.template.path, variables, prepared.url),
		prepared.template.noteContentFormat
			? compileTemplate(prepared.tabId, prepared.template.noteContentFormat, variables, prepared.url)
			: Promise.resolve('')
	]);

	return {
		...prepared,
		variables,
		fileContent: await generateFrontmatter(compiledProperties) + noteContent,
		noteName: noteName.trim(),
		path,
	};
}
