import { idbGetLogs, idbClearLogs } from "../../lib/db.js";
import { STORAGE_KEYS } from "../../lib/settings.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import { formatBytes } from "../../lib/ui.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setThemeToggleGlyph,
  setToolbarIcon
} from "../../lib/theme.js";

const logsEl = document.getElementById("logs");
const statusEl = document.getElementById("status");
const storageUsageEl = document.getElementById("storageUsage");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

let themeMode = "light";
let logsMascotEl = null;
let logsContentEl = null;
let localeApplyVersion = 0;
const INIT_STEP_TIMEOUT_MS = 3000;
const STORAGE_ESTIMATE_TIMEOUT_MS = 2500;
const LOGS_LOAD_TIMEOUT_MS = 4000;

function getLogsEmptyMascotSrc(mode) {
  const theme = mode === "dark" ? "dark" : "light";
  return `../../assets/mascots/bug-${theme}.png`;
}

function setStatus(text, ok = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status";
}

function ensureLogsStructure() {
  if (!logsEl) {
    return false;
  }
  const hasAttachedStructure =
    logsMascotEl?.parentElement === logsEl && logsContentEl?.parentElement === logsEl;

  if (hasAttachedStructure) {
    return true;
  }

  logsEl.innerHTML = "";

  logsMascotEl = document.createElement("img");
  logsMascotEl.className = "logs-mascot";
  logsMascotEl.alt = UI_MESSAGES.logs.logsMascotAlt;

  logsContentEl = document.createElement("div");
  logsContentEl.className = "logs-content";
  logsContentEl.textContent = UI_MESSAGES.logs.loading;

  logsEl.append(logsMascotEl, logsContentEl);
  return true;
}

function renderEmptyLogsState() {
  if (!ensureLogsStructure()) {
    return;
  }
  logsEl.classList.add("empty-state");
  logsEl.classList.remove("has-logs");

  logsMascotEl.src = getLogsEmptyMascotSrc(themeMode);
  logsContentEl.textContent = UI_MESSAGES.logs.noLogsYet;
}

function updateLogsEmptyStateMascot(mode) {
  if (!logsMascotEl) {
    return;
  }
  logsMascotEl.src = getLogsEmptyMascotSrc(mode);
}

function invalidatePendingLocaleApply() {
  localeApplyVersion += 1;
}

function withTimeout(promise, timeoutMs, code = "TIMEOUT") {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(code));
    }, Math.max(0, timeoutMs));
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function renderStorageEstimate() {
  if (!storageUsageEl) {
    return;
  }

  if (!navigator.storage || typeof navigator.storage.estimate !== "function") {
    storageUsageEl.textContent = UI_MESSAGES.logs.storageEstimateApiUnavailable;
    return;
  }

  try {
    const quota = await withTimeout(
      navigator.storage.estimate(),
      STORAGE_ESTIMATE_TIMEOUT_MS,
      "STORAGE_ESTIMATE_TIMEOUT",
    );
    const totalSpace = quota.quota || 0;
    const usedSpace = quota.usage || 0;
    storageUsageEl.textContent = UI_MESSAGES.logs.storageUsage(
      formatBytes(usedSpace, ["B", "KB", "MB", "GB", "TB"]),
      formatBytes(totalSpace, ["B", "KB", "MB", "GB", "TB"]),
    );
  } catch {
    storageUsageEl.textContent = UI_MESSAGES.logs.storageEstimateFailed;
  }
}

async function renderLogs() {
  if (!logsEl) {
    setStatus(UI_MESSAGES.logs.failedToLoad);
    return;
  }

  await renderStorageEstimate();
  let logs = [];
  try {
    logs = await withTimeout(idbGetLogs(500), LOGS_LOAD_TIMEOUT_MS);
  } catch {
    renderEmptyLogsState();
    setStatus(UI_MESSAGES.logs.failedToLoad);
    return;
  }

  if (!logs.length) {
    renderEmptyLogsState();
    setStatus(UI_MESSAGES.logs.logCount(0), true);
    return;
  }

  const lines = logs.map((log) => {
    const when = new Date(log.createdAt || Date.now()).toLocaleTimeString();
    const details = log.details ? ` ${JSON.stringify(log.details)}` : "";
    return `[${when}] ${log.stage}: ${log.message}${details}`;
  });

  ensureLogsStructure();
  logsEl.classList.remove("empty-state");
  logsEl.classList.add("has-logs");
  logsMascotEl.src = getLogsEmptyMascotSrc(themeMode);
  logsContentEl.textContent = lines.join("\n");
  setStatus(UI_MESSAGES.logs.logCount(logs.length), true);
}

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  void setToolbarIcon(theme);
  setThemeToggleGlyph(themeToggleBtn, theme);
  themeMode = theme;
  updateLogsEmptyStateMascot(theme);
}

async function applyLocale(localeHint = "") {
  const applyVersion = ++localeApplyVersion;
  await initializeI18n(
    localeHint
      ? {
          localeHint,
          useStoredLocale: false,
          persistDetectedLocale: false,
        }
      : {},
  );
  if (applyVersion !== localeApplyVersion) {
    return;
  }
  applyStaticI18n();
  if (logsMascotEl) {
    logsMascotEl.alt = UI_MESSAGES.logs.logsMascotAlt;
  }
}

refreshBtn?.addEventListener("click", () => {
  void renderLogs();
});

clearBtn?.addEventListener("click", async () => {
  await idbClearLogs();
  setStatus(UI_MESSAGES.logs.logsCleared, true);
  await renderLogs();
});

themeToggleBtn?.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setThemeMode(themeMode);
});

if (globalThis.chrome?.storage?.onChanged?.addListener) {
  globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.themeMode]) {
      const next = changes[STORAGE_KEYS.themeMode].newValue === "dark" ? "dark" : "light";
      applyTheme(next);
    }

    if (changes[STORAGE_KEYS.locale]?.newValue) {
      const nextLocale = String(changes[STORAGE_KEYS.locale].newValue || "").trim();
      void (async () => {
        await applyLocale(nextLocale);
        await renderLogs();
      })();
    }
  });
}

async function init() {
  ensureLogsStructure();
  await withTimeout(applyLocale(), INIT_STEP_TIMEOUT_MS, "LOCALE_INIT_TIMEOUT").catch(
    () => {
      // Prevent a late locale init from rewriting #logs after renderLogs() ran.
      invalidatePendingLocaleApply();
    },
  );
  const initialTheme = await withTimeout(
    getThemeMode(),
    INIT_STEP_TIMEOUT_MS,
    "THEME_LOAD_TIMEOUT",
  ).catch(() => "light");
  applyTheme(initialTheme);
  await renderLogs();
}

init().catch(() => {
  ensureLogsStructure();
  renderEmptyLogsState();
  setStatus(UI_MESSAGES.logs.failedToLoad);
});
