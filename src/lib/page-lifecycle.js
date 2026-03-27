import { STORAGE_KEYS } from "./settings.js";

function addThemeLocaleStorageListener({ onThemeChange, onLocaleChange }) {
  const listener = (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.themeMode] && typeof onThemeChange === "function") {
      onThemeChange(changes[STORAGE_KEYS.themeMode].newValue);
    }

    if (changes[STORAGE_KEYS.locale] && typeof onLocaleChange === "function") {
      const nextLocale = String(changes[STORAGE_KEYS.locale].newValue || "").trim();
      onLocaleChange(nextLocale);
    }
  };

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    globalThis.chrome.storage.onChanged.addListener(listener);
  }

  return () => {
    if (globalThis.chrome?.storage?.onChanged?.removeListener) {
      globalThis.chrome.storage.onChanged.removeListener(listener);
    }
  };
}

export { addThemeLocaleStorageListener };
