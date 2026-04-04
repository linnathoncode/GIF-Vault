# GIF Vault (Manifest V3)

`GIF Vault` is a Chrome/Chromium extension for importing, converting, and organizing GIFs from direct media URLs and X/Twitter posts into a local searchable vault.

## Features

- One-click context menu import for image/video elements
- Popup URL import for GIF/image/video links and X/Twitter post URLs
- X/Twitter media resolution with deduped quality variants and video-to-GIF conversion
- Safer batch import behavior with atomic failure handling and no rollback of already-saved items on user cancel
- Local IndexedDB vault with favorites, search, rename, copy, drag/drop, and pagination
- Shift-click range selection and safer multi-select delete workflow in the popup grid
- Import progress states with termination support and cleaner restore behavior (no ghost replay)
- Runtime host-permission assist flow for unknown hosts
- Hardened import pipeline guards (HTTP/HTTPS URL validation, redirect re-validation, and strict download size enforcement)
- Logs page with storage usage, repeated-entry bundling toggle, and up to 500 retained entries
- Cross-page i18n support with Turkish (`tr`) locale and settings language selector
- Light/dark themes with theme-aware placeholder mascots in popup, logs, and permission-assist pages

## Project Layout

```txt
src/
  manifest.json
  assets/icons/
  background/
  offscreen/
  pages/
    assist/
    logs/
    options/
    popup/
  lib/
  vendor/@ffmpeg/...
dist/
```

## Build

```bash
git clone https://github.com/linnathoncode/GIF-Vault.git
cd GIF-Vault
npm install
npm run build
```

On some PowerShell setups, use `npm.cmd run build` if `npm.ps1` is blocked by execution policy.

## Chrome Web Store

- [Install from Chrome Web Store](https://chromewebstore.google.com/detail/kcpmhpeolcdfbbfndkhfnbhmfknfjelp?utm_source=item-share-cb)

## Release Downloads

If you prefer prebuilt packages, download from GitHub Releases:
The table below highlights releases with significant changes. It may not list every version and may occasionally lag behind the latest published tag.

| Version    | Download Link                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :--------- | :--------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.6.3** | [GIF_Vault_v1.6.3.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.3/GIF_Vault_v1.6.3.zip) | Latest release. Compared with the previous version, this release adds import-cancel UX/perf improvements (faster terminate propagation with temporary action-button lock), popup coordinator/grid-controller maintenance cleanup (doc comments + centralized timing constants), portrait-video GIF conversion scaling fixes to reduce disproportionate output sizes, drag/drop guard consistency for in-popup drags, and compact folder-icon local import action inside the popup URL field. |
| **v1.6.1** | [GIF_Vault_v1.6.1.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.1/GIF_Vault_v1.6.1.zip) | Security hardening after `v1.5.0` includes strict URL/redirect/media validation, configurable download-size limits, and a global single-active-import guard across popup/context-menu/assist flows. UI updates include refreshed popup card/actions layout, improved progress/empty-state behavior, clearer dark-theme tab selection, and streamlined always-open feedback flow in Options. |
| **v1.5.0** | [GIF_Vault_v1.5.0.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.5.0/GIF_Vault_v1.5.0.zip) | Legacy major reliability/UX baseline release (atomic batch import safety, improved popup progress lifecycle, Turkish locale support, logs bundling readability, and mascot/theme placeholder refresh). |
| **v1.4.2** | [GIF_Vault_v1.4.2.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.4.2/GIF_Vault_v1.4.2.zip) | Legacy major UX/import-flow release with options controls, improved progress lifecycle, and stronger multi-select delete safety.                                                                                                                                                                                                                                                                                               |
| **v1.3.6** | [GIF_Vault_v1.3.6.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.6/GIF_Vault_v1.3.6.zip) | Legacy stable release with faster import paths and popup progress/error handling.                                                                                                                                                                                                                                                                                                                                              |
| **v1.3.3** | [GIF_Vault_v1.3.3.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.3/GIF_Vault_v1.3.3.zip) | Legacy structured build with stricter host-permission model.                                                                                                                                                                                                                                                                                                                                                                   |
| **v1.2.5** | [GIF_Vault_v1.2.5.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.2.5/GIF_Vault_v1.2.5.zip) | Legacy looser-permission release.                                                                                                                                                                                                                                                                                                                                                                                              |

## Privacy Policy

- [Privacy Policy](https://linnathoncode.github.io/GIF-Vault/privacy-policy.html)

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select either `dist/` or an extracted release zip folder.

## Notes

- Data is stored locally in extension IndexedDB (current browser profile).
- Log retention is capped at 500 entries.
- Private/protected X/Twitter media may fail to resolve.
- FFmpeg conversion can be CPU and memory intensive on lower-end devices.
