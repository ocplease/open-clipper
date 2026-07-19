# Open Clipper Privacy Policy

**Effective date: July 19, 2026**

Open Clipper is an open-source browser extension that converts webpages into Markdown, saves highlights and clips, and transfers content to Obsidian. This Privacy Policy explains how Open Clipper processes information.

## 1. Information Open Clipper processes

### Webpage content

When you use clipping, highlighting, or Reader Mode, Open Clipper may process:

- The current page URL and title
- Selected text
- Readable page content and HTML
- Page metadata, author, publication date, and site name
- Image, video, favicon, and other media URLs
- Highlights you create

This content is processed locally by default. Open Clipper does not collect unrelated browsing history or monitor pages for advertising or analytics.

### Locally stored information

Open Clipper may store the following information on your device:

- Saved clips and generated Markdown
- Source URLs and page metadata associated with saved clips
- Highlights and per-domain highlight settings
- Clip history
- Reader Mode settings
- Templates, vault names, paths, and custom CSS
- Extension preferences and usage counters

Saved clips are stored locally using the browser's IndexedDB storage.

### Synced browser settings

Some settings are stored using `chrome.storage.sync` and may be synchronized through your browser account if Chrome Sync is enabled. These may include:

- Templates and extension preferences
- AI provider and model configurations
- User-provided AI provider API keys
- Reader and highlighter preferences

Chrome Sync is operated by Google and is subject to your browser and Google account settings.

## 2. AI and third-party processing

### User-configured AI providers

The optional Interpreter feature allows you to configure an AI provider. When enabled, Open Clipper sends the prompt, relevant webpage content, template variables, model configuration, and the API credential you supplied directly to the provider endpoint you configured.

Open Clipper does not control how user-configured providers retain or use submitted data. Their privacy policies and terms apply. Do not enable this feature for sensitive content unless you trust the selected provider.

### Xiaohongshu image recognition

When you clip a supported Xiaohongshu post in Chrome, Open Clipper may send the following information to the Open Clipper image-recognition service:

- A Xiaohongshu note identifier
- Image URLs and image contents
- An anonymous Supabase user identifier
- Authentication tokens required to access the service

The service uses Supabase infrastructure and sends image contents to the Google Gemini API for text recognition. Recognized text is returned to the extension and added to the generated Markdown.

Open Clipper does not intentionally persist image contents or recognized text on its application database. The database stores only quota-related information, including:

- Anonymous user identifier
- Usage date
- Number of images processed
- Number of requests
- Last update time

Supabase and Google may maintain operational logs or process submitted data according to their own policies:

- [Supabase Privacy Policy](https://supabase.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Gemini API Terms](https://ai.google.dev/gemini-api/terms)

If you do not want Xiaohongshu images processed by these services, do not use Open Clipper to clip supported Xiaohongshu posts.

## 3. Obsidian and exported content

When you save content to Obsidian, Open Clipper may place generated Markdown on the clipboard and invoke an Obsidian custom URI. This transfer occurs locally between the extension and the installed Obsidian application.

When you download a Markdown file, the file is created locally on your device.

Obsidian's handling of imported content is governed by the [Obsidian Privacy Policy](https://obsidian.md/privacy).

## 4. How information is used

Open Clipper uses processed information only to:

- Extract and convert user-selected webpages to Markdown
- Create and manage clips and highlights
- Provide Reader Mode
- Copy, download, or transfer content to Obsidian
- Apply templates and user preferences
- Process optional AI requests
- Recognize text in supported Xiaohongshu images
- Enforce image-recognition usage limits
- Diagnose errors and maintain extension functionality

Open Clipper does not use user data for advertising, profiling, credit decisions, or unrelated purposes.

## 5. Sharing and sale of information

Open Clipper does not sell personal information.

Information is shared only when necessary to provide a user-requested feature, including with:

- A user-configured AI provider
- Supabase for anonymous authentication and image-recognition processing
- Google Gemini for Xiaohongshu image recognition
- Chrome Sync when enabled by the user
- Obsidian when the user saves content to Obsidian

Information may also be disclosed if required by law or necessary to protect the security and integrity of the service.

## 6. Data retention and deletion

Locally stored clips, highlights, history, and settings remain until you delete them, clear the extension's storage, reset the extension, or uninstall it.

Synced settings may remain subject to Chrome Sync and Google account retention controls.

Xiaohongshu images and OCR results are processed transiently and are not intentionally stored in the Open Clipper application database. Anonymous quota records may be retained as necessary to enforce usage limits and operate the service.

You can stop future processing by disabling optional AI features, removing configured providers and API keys, avoiding Xiaohongshu clipping, or uninstalling Open Clipper.

## 7. Security

Open Clipper uses browser-provided storage and permissions and uses encrypted HTTPS connections for supported remote services. However, no method of electronic storage or transmission is completely secure.

API keys configured in the Interpreter are stored in browser extension storage and may be synchronized through Chrome Sync. Users should use restricted API keys where supported and should not reuse credentials from other services.

## 8. Browser permissions

Open Clipper requests browser permissions required to:

- Read and clip user-selected webpages
- Copy generated Markdown to the clipboard
- Provide context-menu actions
- Display the side-panel interface
- Store clips, settings, templates, and highlights
- Inject packaged Reader Mode and highlighting resources
- Support narrowly scoped YouTube requests used by Reader Mode

Information obtained through these permissions is used only to provide Open Clipper's user-facing features.

## 9. Children's privacy

Open Clipper is not directed to children under 13, and the maintainers do not knowingly collect personal information from children.

## 10. Changes to this policy

This Privacy Policy may be updated when Open Clipper's functionality or data-processing practices change. Material changes will be published with a revised effective date.

## 11. Contact

For privacy questions or requests, contact the Open Clipper maintainers through:

[https://github.com/ocplease/open-clipper/issues](https://github.com/ocplease/open-clipper/issues)

Do not include API keys, private webpage content, or other sensitive information in a public GitHub issue.
