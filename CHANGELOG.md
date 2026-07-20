# CHANGELOG

All notable project changes are tracked here.

## Version Includes: NEXT

- Portable vault backup: users can download their saved media and metadata as a private JSON backup, then restore it additively in another browser profile while skipping duplicate items.
- Import & Backup page: users can import pasted URL lists or selected files through a sequential queue with per-item results and stop support, and manage portable vault backups.

## Version Includes: v1.6.9

- Import cancellation reliability: terminating an import now forwards cancellation into the offscreen FFmpeg bridge so active conversion workers stop more cleanly, with fail-closed validation for offscreen sender messages.
- Popup library performance: grid paging and visible-card hydration now use metadata cursor reads and readonly blob transactions to reduce IndexedDB work while browsing larger vaults.
- Popup UI polish: selection header controls and delete-action theme colors were refined for clearer multi-select and destructive-action states.
- Chrome Web Store release automation: version tags on `master` can now build, package, upload, and submit the extension through Chrome Web Store API V2.

## Version Includes: v1.6.8

- Instagram context-menu image-only guard: Instagram imports now block non-image media (including `/p/...` video posts) while preserving image-post import behavior.
- Instagram SPA navigation reliability: stale captured Instagram context media is now cleared on in-page URL changes to prevent page-mismatch failures after navigating between posts.
- Context-menu logging clarity: stale/expired Instagram page-menu captures now log explicit block reasons instead of fallback-oriented mismatch/expiry messages.

## Version Includes: v1.6.6

- Import URL-resolution expansion: media resolver is now strategy-based (direct media, X/Twitter post, and HTML-embedded media pages), enabling page-style links (for example screenshot-host pages with `og:image`/`twitter:image`) to resolve to real media URLs more reliably while filtering decorative assets.
- Popup theme polish: improved dark/light visual consistency with matte surfaces, clearer tab state treatment, stronger multi-select visibility, and more readable hover feedback on cards/actions.

## Version Includes: v1.6.5

- Import stability guardrail: max configurable download-size limit in Options is now capped at 64 MB (previously 200 MB) to reduce oversized conversion-message failures.
- Conversion payload hardening: offscreen now enforces a strict converted-GIF response-size ceiling for runtime messaging safety, and conversion payload handling is covered with edge-case regressions.

## Version Includes: v1.6.4

- Vertical-video GIF quality refinement: conversion now avoids upscaling beyond source dimensions and uses a more compression-friendly palette strategy to reduce visible dithering artifacts while keeping output size compact.

## Version Includes: v1.6.3

- Latest release broad summary (vs `v1.6.2`): added import-cancel UX/performance improvements (faster terminate propagation with temporary popup action-button lock), popup coordinator/grid-controller maintenance cleanup (doc comments + centralized timing constants), portrait-video GIF conversion scaling improvements to reduce disproportionate output sizes, drag/drop guard consistency for in-popup drags, and a compact folder-icon local-import action inside the popup URL field.

## Version Includes: v1.6.2

- Added local file import from popup with a compact "Choose files" action that uses the same progress/status pipeline as URL imports (including video-to-GIF conversion for supported local videos).
- Added drag-and-drop local file import across the popup surface to start imports quickly without opening the file picker.
- Store-listing copy alignment: explicitly included local file import support (and popup drag-and-drop local import support) in the listed user-facing capabilities.
- Improved local/dragged item metadata and copy behavior: cards now show `local` as source when no web source exists, copy action clearly reports when no source URL is available for local-origin items, and drag-dropped web media now preserves source URL when the browser exposes it via drop data.
- Updated popup multi-select flow so after the first selection, regular left-click can add/remove cards without requiring Shift on every click.
- Added a header-level clear control that appears during multi-select and clears current selections immediately.
- Refined header actions to prevent overflow: clear-selection and clear-all controls now use compact labels/icon hints.
- Refined selection-clear affordance: multi-select header control now uses a short "Clear" label to make non-destructive behavior more obvious.
- Added keyboard delete support for multi-select mode: Delete/Backspace removes selected items after confirmation.
- Import cancel UX/performance: while cancellation is pending, popup action buttons are temporarily disabled to prevent conflicting actions, and cancel requests now return/propagate faster (including during conversion-heavy paths).
- Internal maintenance: added controller doc comments for popup import/grid coordinators and centralized popup grid timing constants in `src/lib/settings.js`.

## Version Includes: v1.6.1

- Popup UI refresh: de-pilled layout, tighter alignment, clearer divider/progress behavior, icon-only card actions, and hover-only source/size metadata row.
- Favorites action now uses a filled star icon for stronger state clarity.
- Options feedback flow simplified: composer is always visible with a direct "Send by email" action.
- Empty-state layout now fills available grid space more cleanly (including scrollbar handling).

## Version Includes: v1.5.0

- Import safety and reliability upgrades: global single-active-import guard, stricter URL/redirect/media validation, configurable max download-size limits, and atomic batch rollback behavior.
- Multi-select workflow improvements: Shift-click range selection, selection-aware favorite/delete actions, and safer armed-delete behavior.
- Logs upgrades: bundled/unbundled views, grouped repeated-success entries, increased retention cap (500), and built-in bug-report email flow with downloadable log attachment.
- Localization and messaging infrastructure: centralized `UI_MESSAGES`, Turkish locale support, locale-safe import progress phase metadata, and shared theme/locale lifecycle wiring.
- Popup resilience improvements: startup loading lock, progress ghost-replay fix, and clearer permission-vs-progress feedback separation.
