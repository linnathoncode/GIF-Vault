import { STORAGE_KEYS, GIF_CONVERSION, POPUP_MENU } from "./settings.js";

const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  gifConversion: Object.freeze({
    fps: GIF_CONVERSION.fps,
    width: GIF_CONVERSION.width,
    maxColors: GIF_CONVERSION.maxColors,
    maxDurationSeconds: GIF_CONVERSION.maxDurationSeconds,
  }),
  popupMenu: Object.freeze({
    pageSize: POPUP_MENU.pageSize,
    defaultTab: POPUP_MENU.defaultTab,
    hoverPreviewEnabled: POPUP_MENU.hoverPreviewEnabled,
    hoverPreviewDelayMs: POPUP_MENU.hoverPreviewDelayMs,
    copyFeedbackResetDelayMs: POPUP_MENU.copyFeedbackResetDelayMs,
    importProgressPercent: Object.freeze({
      ...POPUP_MENU.importProgressPercent,
    }),
  }),
});

// Normalization helpers for stored runtime config.
function normalizePositiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeProgressValue(value, fallback) {
  return normalizePositiveInt(value, fallback, 0, 100);
}

function normalizeDefaultTab(value, fallback) {
  if (value === "favorites" || value === "fav") {
    return "favorites";
  }
  if (value === "all") {
    return "all";
  }
  return fallback;
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1" || value === 1) {
    return true;
  }
  if (value === "false" || value === "0" || value === 0) {
    return false;
  }
  return fallback;
}

// Runtime config schema normalization.
function normalizeRuntimeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const gifInput = input.gifConversion || {};
  const popupInput = input.popupMenu || {};
  const progressInput = popupInput.importProgressPercent || {};
  const defaultProgress = DEFAULT_RUNTIME_CONFIG.popupMenu.importProgressPercent;

  return {
    gifConversion: {
      fps: normalizePositiveInt(
        gifInput.fps,
        DEFAULT_RUNTIME_CONFIG.gifConversion.fps,
        1,
        30,
      ),
      width: normalizePositiveInt(
        gifInput.width,
        DEFAULT_RUNTIME_CONFIG.gifConversion.width,
        120,
        1920,
      ),
      maxColors: normalizePositiveInt(
        gifInput.maxColors,
        DEFAULT_RUNTIME_CONFIG.gifConversion.maxColors,
        2,
        256,
      ),
      maxDurationSeconds: normalizePositiveInt(
        gifInput.maxDurationSeconds,
        DEFAULT_RUNTIME_CONFIG.gifConversion.maxDurationSeconds,
        1,
        60,
      ),
    },
    popupMenu: {
      pageSize: normalizePositiveInt(
        popupInput.pageSize,
        DEFAULT_RUNTIME_CONFIG.popupMenu.pageSize,
        1,
        60,
      ),
      defaultTab: normalizeDefaultTab(
        popupInput.defaultTab,
        DEFAULT_RUNTIME_CONFIG.popupMenu.defaultTab,
      ),
      hoverPreviewEnabled: normalizeBoolean(
        popupInput.hoverPreviewEnabled,
        DEFAULT_RUNTIME_CONFIG.popupMenu.hoverPreviewEnabled,
      ),
      hoverPreviewDelayMs: normalizePositiveInt(
        popupInput.hoverPreviewDelayMs,
        DEFAULT_RUNTIME_CONFIG.popupMenu.hoverPreviewDelayMs,
        500,
        5000,
      ),
      copyFeedbackResetDelayMs: normalizePositiveInt(
        popupInput.copyFeedbackResetDelayMs,
        DEFAULT_RUNTIME_CONFIG.popupMenu.copyFeedbackResetDelayMs,
        100,
        5000,
      ),
      importProgressPercent: {
        resolving: normalizeProgressValue(
          progressInput.resolving,
          defaultProgress.resolving,
        ),
        fetching: normalizeProgressValue(
          progressInput.fetching,
          defaultProgress.fetching,
        ),
        checking: normalizeProgressValue(
          progressInput.checking,
          defaultProgress.checking,
        ),
        converting: normalizeProgressValue(
          progressInput.converting,
          defaultProgress.converting,
        ),
        saving: normalizeProgressValue(progressInput.saving, defaultProgress.saving),
        idle: normalizeProgressValue(progressInput.idle, defaultProgress.idle),
        complete: normalizeProgressValue(
          progressInput.complete,
          defaultProgress.complete,
        ),
      },
    },
  };
}

// Storage access for runtime config.
function readFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.runtimeConfig], (result) => {
      resolve(result[STORAGE_KEYS.runtimeConfig] || null);
    });
  });
}

function writeToStorage(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.runtimeConfig]: value }, resolve);
  });
}

// Public runtime config API.
async function getRuntimeConfig() {
  const stored = await readFromStorage();
  return normalizeRuntimeConfig(stored || DEFAULT_RUNTIME_CONFIG);
}

async function setRuntimeConfig(nextConfig) {
  const normalized = normalizeRuntimeConfig(nextConfig);
  await writeToStorage(normalized);
  return normalized;
}

async function resetRuntimeConfig() {
  const defaults = normalizeRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
  await writeToStorage(defaults);
  return defaults;
}

export {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfig,
  getRuntimeConfig,
  setRuntimeConfig,
  resetRuntimeConfig,
};
