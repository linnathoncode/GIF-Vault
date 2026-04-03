# AGENTS.md

## Workspace Context

- Date snapshot: 2026-03-17
- Workspace: `c:\Users\MONSTER\Desktop\GIF_Manager`
- Shell: `powershell`
- Timezone: `Europe/Istanbul`

## Release State

- Branch: `test`
- HEAD: `4cab35e`
- Version: `1.6.2`

## Project Purpose

GIF Vault is a Manifest V3 Chrome/Opera extension that saves GIFs and short media into a local vault.

Core capabilities:

- Save media via context menu and popup URL import.
- Resolve Twitter/X post URLs to direct media URLs.
- Convert supported video inputs (mp4/webm) to GIF in an offscreen document.
- Persist media and logs in IndexedDB.
- Browse with pagination, favorites, search, rename, copy, and delete controls.

## Store Listing Features

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

- When a worthwhile user-facing feature is added, append it to `## Recently Added` below (and update this section if store-copy should change).
- When the app version changes, insert a clear version marker inside `## Recently Added` (for example `### Since v1.6.1`) so changes after each version are easy to spot.

## Source Layout

- `src/manifest.json`: MV3 manifest.
- `src/background/service-worker.js`: Chrome event/message routing.
- `src/background/import-service.js`: Import orchestration, permission checks, progress reporting.
- `src/background/media-resolver.js`: URL/media resolution.
- `src/background/action-icon.js`: Toolbar icon/badge helpers.
- `src/offscreen/offscreen.js`: FFmpeg offscreen conversion path.
- `src/pages/popup/`: Popup entry files (`popup.js`, `popup.css`, `popup.html`) plus the popup subsystem folder `popup/`.
- `src/pages/popup/popup/`: Popup internal modules (`state.js`, `status.js`, `tab.js`, `import-flow.js`, `import-state.js`, `grid.js`, `grid/`).
- `src/pages/assist/`: Permission assist page.
- `src/pages/logs/`: Logs page.
- `src/pages/options/`: Settings/options page.
- `src/lib/`: Shared helpers (`async.js`, `db.js`, `theme.js`, `ui.js`, `log.js`, `runtime-config.js`, `messages.js`, `protocol.js`, `page-lifecycle.js`).
- `src/assets/icons/app/`: Manifest/action PNG icon sizes.
- `src/assets/icons/brand/`: In-page SVG logos.

## Build and Test

- Build: `npm.cmd run build`
- Verify: `npm.cmd run build:verify`
- Tests: `npm.cmd test`

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
- Popup grid internals live in `src/pages/popup/popup/grid/` with focused modules (`controller.js`, `data.js`, `preview.js`, `focus.js`, `copy.js`, `selection.js`, `media-kind.js`, `dom.js`).

### Popup Card UI Rules (Current)

- Popup header/import/tab sections are de-pilled (no panel/card wrapper chrome), with subtle centered divider lines under header and progress.
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

## Recent Key Changes

- Added `src/lib/messages.js` and moved popup/import/assist/grid text into it.
- Fixed progress-bar overflow handling for long messages.
- Removed duplicate feedback by preventing permission-access hints from being injected into popup progress updates.
- Added test coverage for host-access/progress isolation.

## Recently Added

### Since v1.6.2

- Added local file import from popup with a compact "Choose files" action that uses the same progress/status pipeline as URL imports (including video-to-GIF conversion for supported local videos).
- Added drag-and-drop local file import across the popup surface to start imports quickly without opening the file picker.
- Improved local/dragged item metadata and copy behavior: cards now show `local` as source when no web source exists, copy action clearly reports when no source URL is available for local-origin items, and drag-dropped web media now preserves source URL when the browser exposes it via drop data.
- Updated popup multi-select flow so after the first selection, regular left-click can add/remove cards without requiring Shift on every click.
- Added a header-level clear control that appears during multi-select and clears current selections immediately.
- Refined header actions to prevent overflow: clear-selection and clear-all controls now use compact labels/icon hints.
- Refined selection-clear affordance: multi-select header control now uses a short "Clear" label to make non-destructive behavior more obvious.
- Added keyboard delete support for multi-select mode: Delete/Backspace removes selected items after confirmation.

### Since v1.6.1

- Popup UI refresh: de-pilled layout, tighter alignment, clearer divider/progress behavior, icon-only card actions, and hover-only source/size metadata row.
- Favorites action now uses a filled star icon for stronger state clarity.
- Options feedback flow simplified: composer is always visible with a direct "Send by email" action.
- Empty-state layout now fills available grid space more cleanly (including scrollbar handling).

### Since v1.5.0

- Import safety and reliability upgrades: global single-active-import guard, stricter URL/redirect/media validation, configurable max download-size limits, and atomic batch rollback behavior.
- Multi-select workflow improvements: Shift-click range selection, selection-aware favorite/delete actions, and safer armed-delete behavior.
- Logs upgrades: bundled/unbundled views, grouped repeated-success entries, increased retention cap (500), and built-in bug-report email flow with downloadable log attachment.
- Localization and messaging infrastructure: centralized `UI_MESSAGES`, Turkish locale support, locale-safe import progress phase metadata, and shared theme/locale lifecycle wiring.
- Popup resilience improvements: startup loading lock, progress ghost-replay fix, and clearer permission-vs-progress feedback separation.

## Operational Notes

- Load extension from `dist/` in browser developer mode.
- `release/` contains local package artifacts.
- Avoid reverting permission-assist UX without a stronger, gesture-safe alternative.
- Keep tweakable/static constants centralized in `src/lib/settings.js` (for example popup boot/init timeouts, fallback tabs) and import them into feature modules instead of redefining local literals.
- Add brief doc comments for abstract logic and non-obvious intent.

## Known Issues

- Local-only issue tracking has been moved to `LOCAL_KNOWN_ISSUES.md` (gitignored via `.gitignore`).
