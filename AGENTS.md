# AGENTS.md

## Workspace Context

- Date snapshot: 2026-05-17
- Workspace: `c:\Users\MONSTER\Desktop\projects\GIF_Manager`
- Shell: `powershell`
- Timezone: `Europe/Istanbul`

## Release State

- Branch: `test`
- HEAD: `d157fe0`
- Version: `1.6.9`

## Project Purpose

GIF Vault is a Manifest V3 Chrome/Opera extension that saves GIFs and short media into a local vault.

Core capabilities:

- Save media via context menu and popup URL import.
- Resolve Twitter/X post URLs to direct media URLs.
- Convert supported video inputs (mp4/webm) to GIF in an offscreen document.
- Persist media and logs in IndexedDB.
- Browse with pagination, favorites, search, rename, copy, and delete controls.

## Store Listing Features

### Recently Added (Store Listing)

- Save from the web in one click: Right-click GIFs or images and add them to your vault instantly.
- Paste-and-import support: Import GIF, image, video, or X/Twitter post links directly from the popup.
- Local file import support: Choose one or more local images/videos from popup and import them directly.
- Drag-and-drop import support: Drop local files onto popup to start import without opening the file picker.
- Video to GIF conversion: Turn supported videos into GIFs automatically during import.
- Privacy-first storage: Your media stays in your browser. No account, no tracking.
- Search your collection: Find saved items by name or source link in seconds.
- Favorites tab: Star your best GIFs and access them fast.
- Easy library management: Rename, copy, delete, or clear your saved items anytime.
- Shift-click multi-select: Start selection with Shift-click, then add/remove items with regular click while selection is active.
- In-selection quick clear: A header clear button appears during multi-select and clears current selections in one click.
- In-selection keyboard delete: Press Delete/Backspace during multi-select to remove selected items with confirmation.
- Clean grid layout: Browse your GIFs in a simple visual gallery with pagination.
- Import progress status: See import steps in real time and stop an import if needed.
- Guided permissions flow: If a site needs access, GIF Vault walks you through it.
- Built-in support tools: Send feedback from Options and generate bug-report emails with log attachments from Logs.
- Custom options: Tune GIF conversion and popup behavior with flexible controls for FPS, output width, max colors, max download-size limit, default tab behavior, page size, hover-preview preferences, language selection, and direct feedback submission.
- Light and dark themes: Pick the look you prefer.
- Supported languages: English and Turkish (change via options).

Maintenance rule:

- Keep user-facing store copy in this section only (no detailed per-version history in `AGENTS.md`).
- Track release/version changes in `CHANGELOG.md` under `## Version Includes: ...` markers (keep a `NEXT` placeholder at the top).
- PR/release-note rule: when preparing PR text for a release train, summarize changes from the last released version marker/tag (for example `v1.6.2 -> v1.6.3`) even if the current branch has only merge/sync commits.
- Release-summary rule: for each version marker, prefer broad net-change bullets; if a feature was added and then fixed/refined within the same version, list the feature once (not each intermediate fix).
- README release-table rule: keep version notes as simple/high-level as possible; avoid detailed implementation breakdowns.
- README release-table scope rule: include only user-facing features added or fixes applied.
- README release-table dedupe rule: if a feature was added and then fixed/refined in the same version, mention only the feature.
- README release-table fix rule: mention fixes/tweaks only when they resolve issues that existed in previously listed versions in the table.
- README release-table compare rule: do not mention or compare with previous versions unless the difference is drastic and user-significant.
- Version metadata sync rule: when bumping/publishing a new version, update all version sources together, including `package.json`, `package-lock.json`, and MV3 `src/manifest.json` (`manifest.version`), before building/releasing artifacts.
- Documentation update rule: if a code change affects architecture, file responsibility, public behavior, or workflow expectations, update `AGENTS.md` in the same change.
- Module-doc rule: when creating or substantially reshaping modules, include brief top-of-file documentation comments describing purpose and boundaries.

## Source Layout

- `src/manifest.json`: MV3 manifest.
- `src/background/service-worker.js`: Chrome event/message routing.
- `src/background/import/`: Import subsystem folder.
- `src/background/import/service.js`: Import composition root (wires control/runner/pipeline/runtime/media/offscreen modules).
- `src/background/import/runner.js`: High-level URL/local import runners and phase/error orchestration.
- `src/background/import/pipeline.js`: Media processing pipeline (fetch/validate/convert/save + rollback).
- `src/background/import/control.js`: Import lifecycle control (single-active-import guard, abort/terminate state).
- `src/background/import/runtime.js`: Runtime integration (host permission checks, progress/runtime messaging).
- `src/background/import/offscreen.js`: Offscreen conversion bridge.
- `src/background/import/media-utils.js`: Shared import/media utility helpers.
- `src/background/import-service.js`: Backward-compatible shim that re-exports import API from `src/background/import/service.js`.
- `src/background/media-resolver.js`: Media resolver composition root (classifies URLs and dispatches resolver strategies).
- `src/background/media-resolver/`: Resolver internals grouped by concern.
- `src/background/media-resolver/classifier.js`: URL-class routing (`twitter_post`, `direct_media`, `html_embed_candidate`, `unsupported`).
- `src/background/media-resolver/strategies.js`: Strategy modules for Twitter/X posts, direct media URLs, and HTML-embedded media extraction.
- `src/background/media-resolver/shared.js`: Shared media resolver helpers (host checks, tweet/media extraction, media-type gates).
- `src/background/action-icon.js`: Toolbar icon/badge helpers.
- `src/offscreen/offscreen.js`: FFmpeg offscreen conversion path.
- `src/pages/popup/`: Popup entry files (`popup.js`, `popup.css`, `popup.html`) plus the popup subsystem folder `popup/`.
- `src/pages/popup/popup/`: Popup internal modules (`state.js`, `status.js`, `tab.js`, `import-flow.js`, `import-state.js`, `grid.js`, `grid/`).
- `src/pages/assist/`: Permission assist page.
- `src/pages/logs/`: Logs page (`logs.js` coordinator + `logs-format.js` formatting + `logs-report.js` report helpers + `logs-view.js` view controller).
- `src/pages/options/`: Settings/options page.
- `src/lib/`: Shared helpers (`async.js`, `db.js`, `theme.js`, `ui.js`, `log.js`, `runtime-config.js`, `messages.js`, `protocol.js`, `page-lifecycle.js`).
- `src/assets/icons/app/`: Manifest/action PNG icon sizes.
- `src/assets/icons/brand/`: In-page SVG logos.

## Build and Test

- Build: `npm.cmd run build`
- Verify: `npm.cmd run build:verify`
- Tests: `npm.cmd test`
- Chrome Web Store deploy: push a version tag like `v1.6.9`; GitHub Actions publishes only when the tagged commit is contained in `origin/master` and the tag version matches `package.json` plus `src/manifest.json`.

PowerShell note:

- `npm.ps1` may be blocked by execution policy in this environment; use `npm.cmd`.

## Local Skills Reference

- Local Claude-style skills are available under `.claude/skills/`.
- Each skill should be treated as optional workflow guidance, with `SKILL.md` as the primary entry point when present.
- A skill can be used in two ways:
  - Explicit: user names the skill and asks to use it.
  - Implicit: task clearly matches a skill folder and using it is likely to improve output quality or speed.
- If both built-in Codex skills and `.claude/skills` guidance are relevant, prefer built-in Codex skill execution rules first, then layer `.claude/skills` conventions when they do not conflict.

## Architecture Notes

### Import Pipeline

- `importFromUrl(rawUrl, pageUrl, requestId, resolvedMediaUrlHint)` runs in background.
- Pipeline order: permission check -> media resolve -> fetch -> optional convert -> save -> notify.
- Progress updates are written to `chrome.storage.local` and sent as runtime messages.
- Import/runtime error flow now uses shared protocol error codes (`src/lib/protocol.js`) in addition to localized user text.
- User import termination aborts the background pipeline and forwards a best-effort cancel message to the offscreen FFmpeg bridge so active vendor conversion workers can be terminated.
- Import subsystem modularity:
  - `import/service.js`: composition root
  - `import/runner.js`: entry-point orchestration for URL/local imports
  - `import/pipeline.js`: media-processing operations
  - `import/control.js`: active-import + abort/terminate control
  - `import/runtime.js`: runtime/storage progress + permission interactions
  - `import/media-utils.js`: shared payload/media helper utilities
  - `import/offscreen.js`: offscreen document + conversion bridge

### Media Resolver Architecture

- `src/background/media-resolver.js` is the standalone resolver entry point.
- Resolver flow: normalize/expand URL -> classify source type -> dispatch strategy -> return resolved media candidates.
- URL classes: `twitter_post`, `direct_media`, `html_embed_candidate`, `unsupported`.
- Strategy ownership:
  - `strategies.js`: Twitter/X resolution and generic HTML-embedded media extraction.
  - `shared.js`: host/media helpers shared by classifier and strategies.

### Storage

- IndexedDB splits metadata and blob payloads.
- Popup fetches metadata first, then hydrates blobs for visible page items.
- `chrome.storage.local` holds lightweight runtime state (theme/import status).

### Popup UI

- Uses paginated grid, favorites tab, search, rename, and two-step delete confirmation.
- `popup.js` should remain a page coordinator that wires refs, listeners, storage/runtime sync, and startup flow.
- Popup internals now live under `src/pages/popup/popup/`, grouped by concern instead of adding more flat `popup-*.js` files.
- Import progress bar and transient status are controlled by `src/pages/popup/popup/status.js`.
- Popup state defaults and state mutations are centralized in `src/pages/popup/popup/state.js`.
- Popup tab persistence/default-tab resolution lives in `src/pages/popup/popup/tab.js`.
- Popup import orchestration, permission precheck, and popup-owned import request handling live in `src/pages/popup/popup/import-flow.js`.
- Popup grid item actions and selection hints are handled by `src/pages/popup/popup/grid.js`.
- Popup grid internals live in `src/pages/popup/popup/grid/` and should stay grouped into broader modules: `controller.js`, `card.js`, `data.js`, `interaction.js`, and `media.js`.
- Grid modularity direction: avoid splitting into many micro-files by default; prefer these broader buckets and only split further when a module becomes difficult to reason about.
- Within the grid buckets: keep selection/focus/action orchestration in `interaction.js`, media preview/kind detection in `media.js`, and card construction/copy wiring in `card.js`.
- New-feature modularity rule: implement new features within the agreed broad module buckets (instead of micro-files), and include/update concise module documentation for touched files.

### Logs Page Modularity

- Keep `src/pages/logs/logs.js` as the page coordinator (wiring lifecycle, storage listeners, and async orchestration).
- Keep view rendering/state in `src/pages/logs/logs-view.js`.
- Keep log line formatting/bundling in `src/pages/logs/logs-format.js`.
- Keep bug-report/attachment helpers in `src/pages/logs/logs-report.js`.

### Modularity Directive (Agent Rule)

- Prefer broad, concern-based modules over micro-files.
- New feature work should fit existing module buckets before creating new files.
- Target module buckets in popup grid work: `card`, `data`, `interaction`, `media`, coordinated by `controller`.
- Keep page entry files as coordinators/composition roots; push detailed behavior into concern modules.
- Split files only when readability/ownership genuinely degrades; avoid speculative fragmentation.
- If responsibility boundaries change, update `AGENTS.md` and top-of-file module docs in the same change.

### Popup Card UI Rules (Current)

- Popup header/import/tab sections are de-pilled (no panel/card wrapper chrome), with subtle centered divider lines under header and progress.
- Shared dark theme base background token (`--bg`) is `#28323D` in `src/pages/shared/theme.css`.
- Card action controls are icon-only in the bottom row (rename, copy, favorite, delete) with preserved hover feedback.
- Favorite action uses a filled star asset for favorited items (`src/assets/shared/icon-star-filled.svg`).
- Card hover metadata uses a top full-row overlay in the non-preview section; source/size are shown on hover only.
- Hover metadata visibility is pointer-hover based (`.meta:hover`) and does not persist after button click focus.
- Empty-state grid placeholder is width/height-fitted to available grid space and hides the grid scrollbar while empty.

### Progress Bar Behavior Contract (Important)

- Progress UI source of truth is `STORAGE_KEYS.importState` + `IMPORT_PROGRESS` runtime messages.
- Permission/access guidance must stay on the assist page; do not inject host-access text into popup progress.
- Popup-owned import outcomes (success/error/terminate/permission handoff) must clear stored `importState` after handling to prevent replay on next popup open.
- Clearing popup-owned stored state must not wipe the live progress UI in the same session:
  - use `clearStoredImportStatePreservingUi()` in `popup.js`
  - rely on one-shot guard `state.suppressNextImportStateClearUiReset` in storage-change handling
- Restore flow for inactive stored state must clear storage before transient display:
  - implemented in `src/pages/popup/popup/import-state.js`
- Expected reopen behavior:
  - popup-owned outcomes should not reappear as ghost hints
  - background/context-menu outcomes can still appear when popup is opened later

## Permissions Model

Required permissions:

- `contextMenus`
- `storage`
- `offscreen`

Required host permissions are scoped to core supported hosts.
Optional host permissions:

- `https://*/*`
- `http://*/*`

### Host Access Flow

Current intended flow for missing host access:

1. Background detects missing origin permission.
2. Background opens `pages/assist/permission-assist.html` in a tab.
3. User grants permissions from assist page in a direct user gesture.
4. Assist page sends `IMPORT_URL` to background.

Do not move permission request logic back to popup/background gesture-less paths.

## Centralized Messages (New)

User-facing hints/messages are centralized in:

- `src/lib/messages.js`

Rules:

- Reuse `UI_MESSAGES` constants/functions instead of hardcoded UI strings.
- Keep popup/import/assist user text in this module.
- Favor message builders for count-based strings.

### Permission vs Progress Feedback Rule (Important)

- Permission messaging belongs to the assist page.
- Popup progress bar must not show host-access hint text.
- In `import-service.js`, host-access failures clear progress state without pushing the access hint into `IMPORT_PROGRESS` text.
- Regression coverage exists in `tests/import-service.test.js` to ensure host-access hint text is not sent to popup progress messages.

## Change History

- Versioned release and feature history lives in `CHANGELOG.md` (use it only for release notes/history lookups).
- Keep `AGENTS.md` focused on current architecture, behavior contracts, and working rules.

## Operational Notes

- Load extension from `dist/` in browser developer mode.
- `release/` contains local package artifacts.
- Avoid reverting permission-assist UX without a stronger, gesture-safe alternative.
- Keep tweakable/static constants centralized in `src/lib/settings.js` (for example popup boot/init timeouts, fallback tabs) and import them into feature modules instead of redefining local literals.
- Add brief doc comments for abstract logic and non-obvious intent.
- Git workflow rule: do not create a new branch unless the user explicitly asks for it.

## Known Issues

- Local-only issue tracking has been moved to `LOCAL_KNOWN_ISSUES.md` (gitignored via `.gitignore`).

