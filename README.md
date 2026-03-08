# GIF Vault (Manifest V3)

`GIF Vault` is a Chrome/Chromium extension for collecting GIF media into a local vault, including Twitter/X status imports with MP4-to-GIF conversion.

## Current Features
- Context menu: `Add to GIF Vault` on image/video elements
- Manual URL import from popup (`gif`, direct media URLs, Twitter/X status URLs)
- Twitter/X resolution pipeline (syndication + page fallbacks)
- Offscreen FFmpeg conversion for Twitter MP4 -> GIF
- Video safety limit (max 15 seconds for conversion)
- IndexedDB storage for media blobs
- Popup vault UI:
  - 3-column grid
  - Pagination controls (Prev / Next + page indicator)
  - Favorites tab
  - Rename, copy, favorite, delete
  - Search by name/source
  - Per-item size display
  - Light/Dark theme
- Themed extension icons (light/dark sets)
- Logs page:
  - Live debug logs
  - Storage usage (`navigator.storage.estimate()`)
  - Theme support
  - Stable wrapping for long log lines/URLs

## Project Layout
```txt
src/
  manifest.json
  assets/icons/
  background/service-worker.js
  popup/popup.html
  popup/popup.js
  offscreen/offscreen.html
  offscreen/offscreen.js
  logs/logs.html
  logs/logs.js
  lib/
    db.js
    media.js
    settings.js
  vendor/@ffmpeg/...

dist/
```

## Build
```bash
npm run build
```
Copies `src/*` into `dist/*`.

## Release Download
If you do not want to build locally, you can download the prebuilt package from the GitHub release:

- `v1.2.5` zip: `https://github.com/linnathoncode/GIF-Vault/releases/download/v1.2.5/GIF_Vault_v1.2.5.zip`

Notes:
- This may not be the latest version.
- If you download the zip directly, unzip it first, then load the unzipped folder in Chrome/Opera.

## Load Unpacked
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select either:
   - `dist/` (if you built locally), or
   - unzipped `GIF_Vault_vx.x.x` (if you downloaded from a release zip)

## Notes
- Data is stored in extension IndexedDB (profile-local).
- Log retention cap is 250 entries.
- Media conversion cap: videos longer than 15 seconds are rejected.
- Private/protected tweet media may fail to resolve.
- FFmpeg conversion can be CPU/memory intensive on lower-end machines.
