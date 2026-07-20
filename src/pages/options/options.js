import { OPTIONS_FEEDBACK, STORAGE_KEYS } from "../../lib/settings.js";
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
  setToolbarIcon,
} from "../../lib/theme.js";
import { addThemeLocaleStorageListener } from "../../lib/page-lifecycle.js";

const formEl = document.getElementById("optionsForm");
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("resetBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeToggleIcon = document.getElementById("themeToggleIcon");
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
const guideMascotEl = document.getElementById("guideMascot");
const submitFeedbackBtn = document.getElementById("submitFeedbackBtn");
const submitFeedbackBtnLabel = document.getElementById("submitFeedbackBtnLabel");
const feedbackDescriptionInput = document.getElementById(
  "feedbackDescriptionInput",
);
const feedbackCharCountEl = document.getElementById("feedbackCharCount");
const feedbackStatusEl = document.getElementById("feedbackStatus");
const openLogsBtn = document.getElementById("openLogsBtn");
const FEEDBACK_SUPPORT_EMAIL = "gifvault.support@gmail.com";

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
  assignValue("gifMaxDownloadSizeMb", config.gifConversion.maxDownloadSizeMb);

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
      maxDownloadSizeMb: toInt("gifMaxDownloadSizeMb"),
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
  if (themeToggleIcon) {
    const themeIcon =
      theme === "dark" ? "icon-theme-light.svg" : "icon-theme-moon.svg";
    themeToggleIcon.src = `../../assets/shared/${themeIcon}`;
  }
  void setToolbarIcon(theme);
  if (guideMascotEl) {
    const mascotFile =
      theme === "dark" ? "pesto-all-no-item.webp" : "otha-all-no-item.webp";
    guideMascotEl.src = `../../assets/mascots/${mascotFile}`;
  }
  themeMode = theme;
}

function setFeedbackStatus(text, ok = false) {
  if (!feedbackStatusEl) {
    return;
  }
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    feedbackStatusEl.textContent = "";
    feedbackStatusEl.className = "status";
    feedbackStatusEl.hidden = true;
    return;
  }
  feedbackStatusEl.textContent = text;
  feedbackStatusEl.className = ok ? "status ok" : "status error";
  feedbackStatusEl.hidden = false;
}

function syncFeedbackCharCount() {
  if (!feedbackDescriptionInput || !feedbackCharCountEl) {
    return;
  }
  const count = String(feedbackDescriptionInput.value || "").length;
  feedbackCharCountEl.textContent = UI_MESSAGES.options.feedbackCharCount(
    count,
    OPTIONS_FEEDBACK.maxChars,
  );
}

function openFeedbackDraft(description) {
  const subject = UI_MESSAGES.options.feedbackEmailSubject;
  const body = UI_MESSAGES.options.feedbackEmailBody(description);
  const composeUrl = new URL("https://mail.google.com/mail/");
  composeUrl.searchParams.set("view", "cm");
  composeUrl.searchParams.set("fs", "1");
  composeUrl.searchParams.set("tf", "1");
  composeUrl.searchParams.set("to", FEEDBACK_SUPPORT_EMAIL);
  composeUrl.searchParams.set("su", subject);
  composeUrl.searchParams.set("body", body);
  globalThis.open(composeUrl.toString(), "_blank", "noopener,noreferrer");
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
  if (submitFeedbackBtnLabel) {
    submitFeedbackBtnLabel.textContent = UI_MESSAGES.options.sendFeedbackButton;
  }
  syncFeedbackCharCount();
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

feedbackDescriptionInput?.addEventListener("input", () => {
  syncFeedbackCharCount();
});

submitFeedbackBtn?.addEventListener("click", async () => {
  const feedback = String(feedbackDescriptionInput?.value || "").trim();
  if (!feedback) {
    setFeedbackStatus(UI_MESSAGES.options.feedbackDescriptionRequired);
    feedbackDescriptionInput?.focus();
    return;
  }

  if (submitFeedbackBtn) {
    submitFeedbackBtn.disabled = true;
  }
  setFeedbackStatus(UI_MESSAGES.options.feedbackPreparing);

  try {
    openFeedbackDraft(feedback);
    setFeedbackStatus(UI_MESSAGES.options.feedbackEmailOpened, true);
  } catch {
    setFeedbackStatus(UI_MESSAGES.options.feedbackFailed);
  } finally {
    if (submitFeedbackBtn) {
      submitFeedbackBtn.disabled = false;
    }
  }
});

openLogsBtn?.addEventListener("click", () => {
  globalThis.open("../logs/logs.html", "_blank", "noopener,noreferrer");
});

themeToggleBtn.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setThemeMode(themeMode);
});

addThemeLocaleStorageListener({
  onThemeChange(nextTheme) {
    applyTheme(nextTheme);
  },
  onLocaleChange(nextLocale) {
    void (async () => {
      await applyLocale(nextLocale);
      setLocaleValue(nextLocale);
      setStatus(UI_MESSAGES.options.statusLanguageUpdated, "ok");
    })();
  },
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.runtimeConfig]?.newValue) {
    fillForm(
      normalizeRuntimeConfig(changes[STORAGE_KEYS.runtimeConfig].newValue),
    );
  }
});

// Page bootstrap.
async function init() {
  if (feedbackDescriptionInput) {
    feedbackDescriptionInput.maxLength = OPTIONS_FEEDBACK.maxChars;
  }
  await applyLocale();
  applyTheme(await getThemeMode());
  setFeedbackStatus("");
  syncFeedbackCharCount();
  fillForm(await getRuntimeConfig());
  setLocaleValue(await getStoredLocale());
  setStatus(UI_MESSAGES.options.statusAdjustAndSave);
}

init();
