# GIF Vault (Chrome Extension)

`GIF Vault` is a Manifest V3 Chrome extension for saving web GIFs and importing Twitter/X links into a local vault.

## Project Layout
```txt
src/
  manifest.json
  background/service-worker.js
  popup/popup.html
  popup/popup.js
  offscreen/offscreen.html
  offscreen/offscreen.js
  logs/logs.html
  logs/logs.js
  lib/db.js
  vendor/@ffmpeg/...

dist/
```

## What It Does
- Imports media from pasted URLs (`.gif`, direct media links, tweet/status links)
- Resolves Twitter/X status links to media
- Converts Twitter MP4 to GIF using FFmpeg in offscreen context
- Stores media in IndexedDB
- Popup supports:
  - All / Favorites tabs
  - Copy / Favorite / Delete actions
  - Size display per media card

## Build
```bash
npm run build
```
This copies `src/*` to `dist/*`.

## Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Notes
- Data is stored in extension IndexedDB (inside Chrome profile storage)
- Large GIFs can consume quota quickly
- Protected/private tweet media may not resolve
