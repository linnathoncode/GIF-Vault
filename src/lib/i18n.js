import { STORAGE_KEYS } from "./settings.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  UI_MESSAGES,
  getUiLocale,
  normalizeLocale,
  setUiLocale,
} from "./messages.js";

function detectSystemLocale() {
  try {
    if (chrome?.i18n && typeof chrome.i18n.getUILanguage === "function") {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    // ignore
  }

  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return DEFAULT_LOCALE;
}

function readLocaleFromStorage() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local?.get) {
      resolve("");
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.locale], (result) => {
      resolve(String(result?.[STORAGE_KEYS.locale] || "").trim());
    });
  });
}

function writeLocaleToStorage(locale) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local?.set) {
      resolve();
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEYS.locale]: normalizeLocale(locale) }, resolve);
  });
}

async function getStoredLocale() {
  const stored = await readLocaleFromStorage();
  return normalizeLocale(stored || DEFAULT_LOCALE);
}

async function setStoredLocale(locale) {
  const normalized = normalizeLocale(locale);
  await writeLocaleToStorage(normalized);
  setUiLocale(normalized);
  return normalized;
}

function applyLocaleToDocument(locale) {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  document.documentElement.setAttribute("lang", locale);
  document.documentElement.setAttribute("data-locale", locale);
}

async function initializeI18n(options = {}) {
  const localeHint = String(options.localeHint || "").trim();
  const useStoredLocale = options.useStoredLocale !== false;
  const persistDetectedLocale = options.persistDetectedLocale !== false;

  let nextLocale = localeHint ? normalizeLocale(localeHint) : "";
  let hadStoredLocale = false;

  if (!nextLocale && useStoredLocale) {
    const storedRaw = await readLocaleFromStorage();
    hadStoredLocale = Boolean(storedRaw);
    nextLocale = storedRaw ? normalizeLocale(storedRaw) : "";
  }

  if (!nextLocale) {
    nextLocale = normalizeLocale(detectSystemLocale());
    if (persistDetectedLocale && useStoredLocale && !hadStoredLocale) {
      await writeLocaleToStorage(nextLocale);
    }
  }

  setUiLocale(nextLocale);
  applyLocaleToDocument(nextLocale);
  return {
    locale: nextLocale,
    messages: UI_MESSAGES,
  };
}

function resolveMessage(path, source = UI_MESSAGES) {
  if (!path) {
    return "";
  }
  const segments = String(path)
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return "";
    }
    current = current[segment];
  }

  return typeof current === "string" ? current : "";
}

function applyStaticI18n(root = document) {
  if (!root || !root.querySelectorAll) {
    return;
  }

  for (const element of root.querySelectorAll("[data-i18n]")) {
    const text = resolveMessage(element.getAttribute("data-i18n"));
    if (text) {
      element.textContent = text;
    }
  }

  for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
    const text = resolveMessage(element.getAttribute("data-i18n-placeholder"));
    if (text) {
      element.setAttribute("placeholder", text);
    }
  }

  for (const element of root.querySelectorAll("[data-i18n-title]")) {
    const text = resolveMessage(element.getAttribute("data-i18n-title"));
    if (text) {
      element.setAttribute("title", text);
    }
  }

  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    const text = resolveMessage(element.getAttribute("data-i18n-aria-label"));
    if (text) {
      element.setAttribute("aria-label", text);
    }
  }

  for (const element of root.querySelectorAll("[data-i18n-alt]")) {
    const text = resolveMessage(element.getAttribute("data-i18n-alt"));
    if (text) {
      element.setAttribute("alt", text);
    }
  }
}

function isSupportedLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase();
  return SUPPORTED_LOCALES.some(
    (supported) => raw === supported || raw.startsWith(`${supported}-`),
  );
}

export {
  SUPPORTED_LOCALES,
  getUiLocale,
  getStoredLocale,
  initializeI18n,
  isSupportedLocale,
  setStoredLocale,
  applyStaticI18n,
  resolveMessage,
};
