# GIF Vault (Chrome Extension)

`GIF Vault` is a Manifest V3 Chrome extension for saving web GIFs and importing Twitter/X media links into a local vault.

## What It Does
- Imports media from pasted URLs (`.gif`, media links, tweet/status links)
- Resolves Twitter/X status links to media URLs
- Converts Twitter MP4s to GIF using FFmpeg in an offscreen document
- Stores media in extension IndexedDB
- Shows media in a popup grid with:
  - Copy
  - Favorite / Unfavorite
  - Delete
  - All / Favorites tabs

## Quick Run
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder
5. Open the extension popup and paste a media URL

## Notes
- Data is stored locally in the extension’s IndexedDB (not normal files)
- Large GIFs can consume storage quickly
- Protected/private tweet media may not be resolvable
