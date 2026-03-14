import { STORAGE_KEYS, BADGE, ICONS } from "../lib/settings.js";
import { safeLog } from "../lib/log.js";

// Badge and toolbar icon adapters.
async function showBadgeFallback(ok) {
  try {
    await chrome.action.setBadgeBackgroundColor({
      color: ok ? BADGE.okColor : BADGE.errorColor,
    });
    await chrome.action.setBadgeText({
      text: ok ? BADGE.okText : BADGE.errorText,
    });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, BADGE.clearDelayMs);
  } catch {
    // no-op
  }
}

async function syncActionIconToTheme() {
  try {
    const current = await chrome.storage.local.get([STORAGE_KEYS.themeMode]);
    const theme = current[STORAGE_KEYS.themeMode] === "dark" ? "dark" : "light";
    await setActionIcon(theme);
  } catch {
    // no-op
  }
}

async function setActionIcon(theme) {
  const iconPaths = theme === "dark" ? ICONS.dark : ICONS.light;
  await setIconWithImageData(iconPaths);
  await safeLog("theme", "Action icon updated (imageData)", { theme });
}

async function setIconWithImageData(iconPaths) {
  const imageData16 = await iconPathToImageData(iconPaths["16"], 16);
  const imageData32 = await iconPathToImageData(iconPaths["32"], 32);
  await new Promise((resolve, reject) => {
    chrome.action.setIcon(
      {
        imageData: {
          16: imageData16,
          32: imageData32,
        },
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(
            new Error(error.message || "Failed to set action icon via imageData"),
          );
          return;
        }
        resolve();
      },
    );
  });
}

async function iconPathToImageData(path, size) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load icon asset: ${path}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D context for icon rendering");
  }

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

export { setActionIcon, showBadgeFallback, syncActionIconToTheme };
