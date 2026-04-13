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
| **v1.6.6** | [GIF_Vault_v1.6.6.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.6/GIF_Vault_v1.6.6.zip) | Latest release with expanded media URL resolution coverage and polished popup light/dark theme behavior (tabs, selection, hover feedback). |
| **v1.6.5** | [GIF_Vault_v1.6.5.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.5/GIF_Vault_v1.6.5.zip) | Legacy release with stronger conversion payload safety, including a 64 MB options max-download cap and strict converted-GIF runtime-message size guardrails. |
| **v1.6.4** | [GIF_Vault_v1.6.4.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.4/GIF_Vault_v1.6.4.zip) | Release with drag-and-drop import support, improved vertical-video GIF conversion quality, and compact local import action in the popup URL field. |
| **v1.6.1** | [GIF_Vault_v1.6.1.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.6.1/GIF_Vault_v1.6.1.zip) | Added stricter URL/redirect/media validation, configurable download-size limits, single-active-import guard, and popup UI/progress/theme/feedback improvements. |
| **v1.5.0** | [GIF_Vault_v1.5.0.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.5.0/GIF_Vault_v1.5.0.zip) | Added atomic batch import safety, improved popup progress flow, Turkish locale support, and clearer logs bundling. |
| **v1.4.2** | [GIF_Vault_v1.4.2.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.4.2/GIF_Vault_v1.4.2.zip) | Added options controls, improved import progress flow, and safer multi-select delete behavior. |
| **v1.3.6** | [GIF_Vault_v1.3.6.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.6/GIF_Vault_v1.3.6.zip) | Added faster import paths with improved popup progress and error handling. |
| **v1.3.3** | [GIF_Vault_v1.3.3.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.3/GIF_Vault_v1.3.3.zip) | Added a stricter host-permission model and structured build layout. |
| **v1.2.5** | [GIF_Vault_v1.2.5.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.2.5/GIF_Vault_v1.2.5.zip) | Added baseline release packaging with broad host-permission support. |

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
