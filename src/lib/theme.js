import { STORAGE_KEYS, ICONS } from "./settings.js";

let lastToolbarIconTheme = "";

function normalizeThemeMode(mode) {
  return mode === "dark" ? "dark" : "light";
}

function applyDocumentTheme(mode) {
  const theme = normalizeThemeMode(mode);
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

function setThemeToggleGlyph(button, mode) {
  if (!button) {
    return;
  }
  button.textContent = normalizeThemeMode(mode) === "dark" ? "\u2600" : "\u263E";
}

async function setToolbarIcon(theme) {
  const normalizedTheme = normalizeThemeMode(theme);
  if (lastToolbarIconTheme === normalizedTheme) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SET_THEME_ICON",
      theme: normalizedTheme
    });
    if (response?.ok) {
      lastToolbarIconTheme = normalizedTheme;
      return;
    }
  } catch {
    // fallback below
  }

  const paths = ICONS[normalizedTheme];
  await new Promise((resolve) => {
    chrome.action.setIcon(
      {
        path: {
          16: paths["16"],
          32: paths["32"],
          48: paths["48"]
        }
      },
      () => {
        lastToolbarIconTheme = normalizedTheme;
        resolve();
      }
    );
  });
}

function getThemeMode() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.themeMode], (result) => {
      resolve(normalizeThemeMode(result[STORAGE_KEYS.themeMode]));
    });
  });
}

function setThemeMode(theme) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.themeMode]: normalizeThemeMode(theme) }, resolve);
  });
}

export {
  normalizeThemeMode,
  applyDocumentTheme,
  setThemeToggleGlyph,
  setToolbarIcon,
  getThemeMode,
  setThemeMode
};
