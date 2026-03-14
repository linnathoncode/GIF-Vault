# GIF Vault (Manifest V3)

`GIF Vault` is a Chrome/Chromium extension for importing, converting, and organizing GIFs from direct media URLs and X/Twitter posts into a local searchable vault.

## Features

- Context menu import for image/video elements
- Manual URL import from popup
- X/Twitter media resolution and video-to-GIF conversion
- Local IndexedDB vault with favorites, search, rename, copy, drag/drop, and pagination
- Import progress states with termination support
- Runtime host-permission assist flow for unknown hosts
- Logs page with storage usage and wrapped long-line output
- Light/dark theme support

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

- `https://chromewebstore.google.com/detail/kcpmhpeolcdfbbfndkhfnbhmfknfjelp?utm_source=item-share-cb`

## Release Downloads

If you prefer prebuilt packages, download from GitHub Releases:

| Version    | Download Link                                                                                                    | Notes                                                                                                                                                                                                                                   |
| :--------- | :--------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.4.0** | [GIF_Vault_v1.4.0.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.4.0/GIF_Vault_v1.4.0.zip) | **Latest.** Major UX and import-flow update vs `v1.3.6`: added options page and controls, cleaner progress lifecycle (checking/converting/saving), improved popup state reset behavior, and unit test coverage for import/runtime flows. |
| **v1.3.6** | [GIF_Vault_v1.3.6.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.6/GIF_Vault_v1.3.6.zip) | Legacy stable release with faster import paths and popup progress/error handling.                                                                                                                                                       |
| **v1.3.3** | [GIF_Vault_v1.3.3.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.3/GIF_Vault_v1.3.3.zip) | Legacy structured build with stricter host-permission model.                                                                                                                                                                            |
| **v1.2.5** | [GIF_Vault_v1.2.5.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.2.5/GIF_Vault_v1.2.5.zip) | Legacy looser-permission release.                                                                                                                                                                                                       |

## Privacy Policy

- `https://linnathoncode.github.io/GIF-Vault/privacy-policy.html`

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select either `dist/` or an extracted release zip folder.

## Notes

- Data is stored locally in extension IndexedDB (current browser profile).
- Log retention is capped at 250 entries.
- Private/protected X/Twitter media may fail to resolve.
- FFmpeg conversion can be CPU and memory intensive on lower-end devices.
