# GIF Vault (Manifest V3)

`GIF Vault` is a Chrome/Chromium extension for collecting GIFs and short media into a local vault, including Twitter/X status imports with local MP4-to-GIF conversion.

## Current Features
- Context menu import for image/video elements
- Manual URL import from the popup
- Twitter/X status resolution with local MP4-to-GIF conversion when needed
- IndexedDB-backed local vault for media and logs
- Popup vault with pagination, favorites, search, rename, copy, drag/drop, and theme support
- Dedicated logs page with storage usage and wrapped long-line output
- Dedicated permission-assist page for runtime host-permission grants on unknown hosts
- Shared extension-page helpers in `src/lib` for theme, UI formatting, and logging
- Themed toolbar icons driven from the service worker

## Permissions Model
- `v1.2.5` used looser access with `notifications` and broad `<all_urls>` host access.
- `v1.3.1` uses a stricter Chrome Web Store posture:
  - removes `notifications`
  - keeps a smaller required host allowlist for core import sources
  - uses optional runtime host permissions for broader imports
  - routes missing-host imports through `src/assist/permission-assist.html`

## Project Layout
```txt
src/
  manifest.json
  assets/icons/
  assist/
    permission-assist.html
    permission-assist.css
    permission-assist.js
  background/service-worker.js
  popup/
    popup.html
    popup.css
    popup.js
  logs/
    logs.html
    logs.css
    logs.js
  offscreen/
    offscreen.html
    offscreen.js
  lib/
    db.js
    log.js
    media.js
    settings.js
    theme.js
    ui.js
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

In PowerShell on some systems, use `npm.cmd run build` if `npm.ps1` is blocked by execution policy.

## Release Download
If you do not want to build locally, download a prebuilt package from GitHub Releases.

| Version | Download Link | Installation Notes |
| :--- | :--- | :--- |
| **v1.3.1** | [GIF_Vault_v1.3.1.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.3.1/GIF_Vault_v1.3.1.zip) | Latest structured build. Uses stricter required host permissions plus runtime permission prompts through the permission-assist tab for unknown hosts. |
| **v1.2.5** | [GIF_Vault_v1.2.5.zip](https://github.com/linnathoncode/GIF-Vault/releases/download/v1.2.5/GIF_Vault_v1.2.5.zip) | Older looser-permission release. Uses `notifications` and broader `<all_urls>` host access. |

## Load Unpacked
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select either `dist/` or the unzipped `GIF_Vault_vX.X.X` release folder.

## Notes
- Data is stored in extension IndexedDB in the current browser profile.
- Log retention is capped at 250 entries.
- Twitter/X video-to-GIF conversion rejects media longer than 15 seconds.
- Private or protected Twitter/X media may fail to resolve.
- FFmpeg conversion can be CPU and memory intensive on lower-end devices.
