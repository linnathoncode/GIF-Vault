import { STORAGE_KEYS } from "../../lib/settings.js";
import {
  getRuntimeConfig,
  normalizeRuntimeConfig,
  resetRuntimeConfig,
  setRuntimeConfig,
} from "../../lib/runtime-config.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import {
  applyStaticI18n,
  getStoredLocale,
  initializeI18n,
  setStoredLocale,
} from "../../lib/i18n.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setThemeToggleGlyph,
  setToolbarIcon,
} from "../../lib/theme.js";

const formEl = document.getElementById("optionsForm");
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("resetBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const localeInput = document.getElementById("locale");
const hoverPreviewEnabledInput = document.getElementById(
  "popupHoverPreviewEnabled",
);
const hoverPreviewDelayInput = document.getElementById(
  "popupHoverPreviewDelayMs",
);
const hoverPreviewDelayField = document.getElementById(
  "popupHoverPreviewDelayField",
);

let themeMode = "light";

// Small DOM helpers for form I/O.
function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function assignValue(id, value) {
  const input = document.getElementById(id);
  if (!input) {
    return;
  }
  input.value = String(value);
}

function assignChecked(id, value) {
  const input = document.getElementById(id);
  if (!input) {
    return;
  }
  input.checked = Boolean(value);
}

function textValue(id) {
  const input = document.getElementById(id);
  return String(input?.value ?? "");
}

function boolValue(id) {
  const input = document.getElementById(id);
  return Boolean(input?.checked);
}

function toInt(id) {
  const input = document.getElementById(id);
  return Number.parseInt(String(input?.value ?? ""), 10);
}

// Options form serialization.
function fillForm(config) {
  assignValue("gifFps", config.gifConversion.fps);
  assignValue("gifWidth", config.gifConversion.width);
  assignValue("gifMaxColors", config.gifConversion.maxColors);
  assignValue("gifMaxDurationSeconds", config.gifConversion.maxDurationSeconds);

  assignValue("popupDefaultTab", config.popupMenu.defaultTab);
  assignChecked(
    "popupHoverPreviewEnabled",
    config.popupMenu.hoverPreviewEnabled,
  );
  assignValue("popupPageSize", config.popupMenu.pageSize);
  assignValue("popupHoverPreviewDelayMs", config.popupMenu.hoverPreviewDelayMs);
  syncHoverPreviewDelayState();
}

function setLocaleValue(value) {
  assignValue("locale", value);
}

function readFormConfig() {
  return {
    gifConversion: {
      fps: toInt("gifFps"),
      width: toInt("gifWidth"),
      maxColors: toInt("gifMaxColors"),
      maxDurationSeconds: toInt("gifMaxDurationSeconds"),
    },
    popupMenu: {
      defaultTab: textValue("popupDefaultTab"),
      hoverPreviewEnabled: boolValue("popupHoverPreviewEnabled"),
      pageSize: toInt("popupPageSize"),
      hoverPreviewDelayMs: toInt("popupHoverPreviewDelayMs"),
    },
  };
}

function syncHoverPreviewDelayState() {
  const enabled = Boolean(hoverPreviewEnabledInput?.checked);
  if (hoverPreviewDelayInput) {
    hoverPreviewDelayInput.disabled = !enabled;
  }
  if (hoverPreviewDelayField) {
    hoverPreviewDelayField.classList.toggle("disabled", !enabled);
  }
}

// Theme handling for the options page.
function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  setThemeToggleGlyph(themeToggleBtn, theme);
  void setToolbarIcon(theme);
  themeMode = theme;
}

async function applyLocale(localeHint = "") {
  await initializeI18n(
    localeHint
      ? {
          localeHint,
          useStoredLocale: false,
          persistDetectedLocale: false,
        }
      : {},
  );
  applyStaticI18n();
}

async function applyLocaleChangeFromSelector() {
  const selectedLocale = String(localeInput?.value || "").trim();
  if (!selectedLocale) {
    return;
  }

  const normalizedLocale = await setStoredLocale(selectedLocale);
  await applyLocale(normalizedLocale);
  setLocaleValue(normalizedLocale);
  setStatus(UI_MESSAGES.options.statusLanguageUpdated, "ok");
}

// Form events and storage sync.
formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!formEl.reportValidity()) {
    setStatus(UI_MESSAGES.options.statusInvalidFields, "error");
    return;
  }

  const normalized = normalizeRuntimeConfig(readFormConfig());
  await setRuntimeConfig(normalized);
  fillForm(normalized);
  setStatus(UI_MESSAGES.options.statusSaved, "ok");
});

resetBtn.addEventListener("click", async () => {
  const restored = await resetRuntimeConfig();
  fillForm(restored);
  setStatus(UI_MESSAGES.options.statusDefaultsRestored, "ok");
});

hoverPreviewEnabledInput?.addEventListener("change", () => {
  syncHoverPreviewDelayState();
});

localeInput?.addEventListener("change", () => {
  void applyLocaleChangeFromSelector();
});

themeToggleBtn.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setThemeMode(themeMode);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.themeMode]) {
    const nextTheme = changes[STORAGE_KEYS.themeMode].newValue;
    applyTheme(nextTheme);
  }

  if (changes[STORAGE_KEYS.runtimeConfig]?.newValue) {
    fillForm(
      normalizeRuntimeConfig(changes[STORAGE_KEYS.runtimeConfig].newValue),
    );
  }

  if (changes[STORAGE_KEYS.locale]?.newValue) {
    const nextLocale = String(changes[STORAGE_KEYS.locale].newValue || "").trim();
    void (async () => {
      await applyLocale(nextLocale);
      setLocaleValue(nextLocale);
      setStatus(UI_MESSAGES.options.statusLanguageUpdated, "ok");
    })();
  }
});

// Page bootstrap.
async function init() {
  await applyLocale();
  applyTheme(await getThemeMode());
  fillForm(await getRuntimeConfig());
  setLocaleValue(await getStoredLocale());
  setStatus(UI_MESSAGES.options.statusAdjustAndSave);
}

init();
