# AGENTS.md

## Workspace Context

- Date snapshot: 2026-03-17
- Workspace: `c:\Users\MONSTER\Desktop\GIF_Manager`
- Shell: `powershell`
- Timezone: `Europe/Istanbul`

## Release State

- Branch: `test`
- HEAD: `4cab35e`
- Version: `1.6.0`

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
- Video to GIF conversion: Turn supported videos into GIFs automatically during import.
- Privacy-first storage: Your media stays in your browser. No account, no tracking.
- Search your collection: Find saved items by name or source link in seconds.
- Favorites tab: Star your best GIFs and access them fast.
- Easy library management: Rename, copy, delete, or clear your saved items anytime.
- Shift-click multi-select: Select and manage many items at once by shift clicking.
- Clean grid layout: Browse your GIFs in a simple visual gallery with pagination.
- Import progress status: See import steps in real time and stop an import if needed.
- Guided permissions flow: If a site needs access, GIF Vault walks you through it.
- Custom options: Adjust conversion quality and popup behavior.
- Light and dark themes: Pick the look you prefer.
- Supported languages: English and Turkish (change via options).

Maintenance rule:

- When a worthwhile user-facing feature is added, append it to `## Recently Added` below (and update this section if store-copy should change).

## Source Layout

- `src/manifest.json`: MV3 manifest.
- `src/background/service-worker.js`: Chrome event/message routing.
- `src/background/import-service.js`: Import orchestration, permission checks, progress reporting.
- `src/background/media-resolver.js`: URL/media resolution.
- `src/background/action-icon.js`: Toolbar icon/badge helpers.
- `src/offscreen/offscreen.js`: FFmpeg offscreen conversion path.
- `src/pages/popup/`: Popup UI (`popup.js`, `popup-grid.js` facade, `popup-grid/` modules, `popup-status.js`, `popup-import-state.js`, `popup-state.js`, `popup.css`, `popup.html`).
- `src/pages/assist/`: Permission assist page.
- `src/pages/logs/`: Logs page.
- `src/pages/options/`: Settings/options page.
- `src/lib/`: Shared helpers (`db.js`, `theme.js`, `ui.js`, `log.js`, `runtime-config.js`, `messages.js`, `protocol.js`, `page-lifecycle.js`).
- `src/assets/icons/app/`: Manifest/action PNG icon sizes.
- `src/assets/icons/brand/`: In-page SVG logos.

## Build and Test

- Build: `npm.cmd run build`
- Verify: `npm.cmd run build:verify`
- Tests: `npm.cmd test`

PowerShell note:

- `npm.ps1` may be blocked by execution policy in this environment; use `npm.cmd`.

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
- Import progress bar and transient status are controlled by `popup-status.js`.
- Grid item actions and selection hints are handled by `popup-grid.js`.
- Popup state defaults and state mutations are centralized in `popup-state.js`.
- Popup grid was modularized into `src/pages/popup/popup-grid/` with focused modules (`controller.js`, `data.js`, `preview.js`, `focus.js`, `copy.js`, `selection.js`, `media-kind.js`, `dom.js`) while `popup-grid.js` remains a compatibility facade export.

### Progress Bar Behavior Contract (Important)

- Progress UI source of truth is `STORAGE_KEYS.importState` + `IMPORT_PROGRESS` runtime messages.
- Permission/access guidance must stay on the assist page; do not inject host-access text into popup progress.
- Popup-owned import outcomes (success/error/terminate/permission handoff) must clear stored `importState` after handling to prevent replay on next popup open.
- Clearing popup-owned stored state must not wipe the live progress UI in the same session:
  - use `clearStoredImportStatePreservingUi()` in `popup.js`
  - rely on one-shot guard `state.suppressNextImportStateClearUiReset` in storage-change handling
- Restore flow for inactive stored state must clear storage before transient display:
  - implemented in `src/pages/popup/popup-import-state.js`
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

- Options guide now focuses on feedback flow: the Help Docs action was removed, a compact feedback field opens inline to the right when requested, and the same button switches from "Provide Feedback" to "Send by email".
- Options feedback input now has a 500-character cap with a live counter to keep email-draft payload size safe.
- Options page header copy was reverted to the original messaging, warning copy now emphasizes defaults, and dropdown styling was refined to match field corner curvature.
- Logs page now includes an Expand/Bundle toggle button to switch between bundled and unbundled log views.
- Increased log retention cap from 250 to 500 entries.
- Logs page now bundles repeated successful action entries (for example preview creation) into `xN` summary lines while leaving error entries unbundled.
- Added cross-page i18n plumbing with centralized locale storage and static `data-i18n*` key hydration.
- Added Turkish (`tr`) locale support and a language selector on the options page.
- Import progress now supports locale-safe `phase` metadata instead of English text matching.
- Empty popup grid now renders mascot placeholder art above the empty-state message.
- Added theme-aware mascots: `7billion` for popup empty/favorites state and `bug` for empty logs state.
- Added low-opacity, theme-aware mascot background art to the permission-assist page.
- Refreshed mascot set with theme-specific `otha` (light) and `pesto` (dark) variants for popup empty states and logs, using combined `*-log-bug` mascot art on the logs page.
- Permission-assist page mascot now uses a shared dual-character `otha-pesto-permissions` art for both themes.
- Centralized UI text in `src/lib/messages.js`.
- Progress bar now handles long status text without breaking popup layout.
- Permission-assist feedback is isolated from popup progress messaging.
- Multi-select delete now arms all selected cards with a danger `!` state.
- Popup grid now supports Shift-click range selection for faster multi-select workflows.
- Armed multi-select delete is canceled if selection changes.
- Header count now includes selected item count and supports overflow-safe truncation.
- Added atomic batch import rollback for real per-item failures.
- User-terminated imports no longer trigger rollback of already-saved items.
- Fixed popup ghost progress-message replay and added restore/clear ordering safeguards.
- Logs page now includes an email bug-report form that collects user notes, prepares a support email draft to `gifvault-support@gmail.com`, and downloads a log attachment file for sending.
- Options page default tab now supports `Latest`, which reopens the popup on the most recently used tab (`All` or `Favorites`).
- Popup now shows an explicit startup loading state on browser launch and temporarily disables popup interactions until initialization completes.
- Popup now blocks concurrent imports by preventing new import starts while an import is active.
- Background import pipeline now enforces a single active import globally, so context-menu, popup, and assist imports cannot run concurrently.
- Import pipeline now enforces strict `http/https` URL validation, redirect URL re-validation, and hard download-size limits, with stricter media-type fallback checks.
- Options now use a configurable max download-size limit (MB) instead of max video duration for import safety limits.
- Options page UI was redesigned with balanced side-by-side settings cards, an expanded guide panel, and mirrored `all-no-item` mascot art for the settings experience.
- Popup, logs, assist, and options pages now use shared SVG action/header icons from `src/assets/shared` with theme-aware toggle icons and reused alias mappings.
- Added `src/lib/protocol.js` to centralize runtime message types and import error codes for background/popup/assist flows.
- Import/background runtime routing now uses stable protocol constants and structured error-code propagation instead of localized-text-only control flow.
- Added `src/pages/popup/popup-state.js` to centralize popup state defaults and key state transitions.
- Added `src/lib/page-lifecycle.js` and adopted shared theme/locale storage-change wiring in options/logs/assist pages.
- Reorganized icon assets into `src/assets/icons/app` (manifest/action PNG sizes) and `src/assets/icons/brand` (in-page SVG logos), with popup header branding switched to SVG.
- Refactored popup grid to a folder-based module architecture with a thin API facade (`src/pages/popup/popup-grid.js`) and specialized submodules under `src/pages/popup/popup-grid/`.

## Operational Notes

- Load extension from `dist/` in browser developer mode.
- `release/` contains local package artifacts.
- Avoid reverting permission-assist UX without a stronger, gesture-safe alternative.
- Keep tweakable/static constants centralized in `src/lib/settings.js` (for example popup boot/init timeouts, query limits, fallback tabs) and import them into feature modules instead of redefining local literals.
- Add brief doc comments for abstract logic and non-obvious intent.

## Known Issues

- Local-only issue tracking has been moved to `LOCAL_KNOWN_ISSUES.md` (gitignored via `.gitignore`).
