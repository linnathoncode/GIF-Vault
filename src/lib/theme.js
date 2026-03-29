import { STORAGE_KEYS } from "./settings.js";

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
  void theme;
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
