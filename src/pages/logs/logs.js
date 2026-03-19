import { idbGetLogs, idbClearLogs } from "../../lib/db.js";
import { DB, STORAGE_KEYS } from "../../lib/settings.js";
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
const viewToggleBtn = document.getElementById("viewToggleBtn");

let themeMode = "light";
let logsMascotEl = null;
let logsContentEl = null;
let localeApplyVersion = 0;
let latestLoadedLogs = [];
let showUnbundledLogs = false;
const INIT_STEP_TIMEOUT_MS = 3000;
const STORAGE_ESTIMATE_TIMEOUT_MS = 2500;
const LOGS_LOAD_TIMEOUT_MS = 4000;
const LOG_ERROR_HINT_REGEX = /\b(failed|error|rejected|denied|invalid|missing|timeout|aborted|abort|unable|could not)\b/i;

function getLogsEmptyMascotSrc(mode) {
  return mode === "dark"
    ? "../../assets/mascots/pesto-log-bug.webp"
    : "../../assets/mascots/otha-log-bug.webp";
}

function setStatus(text, ok = false) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status";
}

function updateViewToggleButton() {
  if (!viewToggleBtn) {
    return;
  }

  const label = showUnbundledLogs
    ? UI_MESSAGES.logs.bundleAllButton
    : UI_MESSAGES.logs.expandAllButton;
  viewToggleBtn.textContent = label;
  viewToggleBtn.title = label;
  viewToggleBtn.setAttribute("aria-label", label);
  viewToggleBtn.disabled = latestLoadedLogs.length === 0;
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

function isErrorLikeLog(log) {
  const message = String(log?.message || "");
  if (LOG_ERROR_HINT_REGEX.test(message)) {
    return true;
  }

  const details = log?.details;
  if (!details || typeof details !== "object") {
    return false;
  }

  try {
    return LOG_ERROR_HINT_REGEX.test(JSON.stringify(details));
  } catch {
    return false;
  }
}

function formatLogLine(log) {
  const when = new Date(log.createdAt || Date.now()).toLocaleTimeString();
  const details = log.details ? ` ${JSON.stringify(log.details)}` : "";
  return `[${when}] ${log.stage}: ${log.message}${details}`;
}

function formatBundledLogLine(group) {
  const latest = group[0];
  const when = new Date(latest.createdAt || Date.now()).toLocaleTimeString();
  const countSuffix = ` (x${group.length})`;
  return `[${when}] ${latest.stage}: ${latest.message}${countSuffix}`;
}

function buildUnbundledLogLines(logs) {
  return logs.map((log) => formatLogLine(log));
}

function buildRenderedLogLines(logs) {
  const lines = [];
  for (let i = 0; i < logs.length; i += 1) {
    const current = logs[i];
    const signature = `${current.stage}\u0000${current.message}`;
    const group = [current];
    let j = i + 1;
    while (j < logs.length) {
      const candidate = logs[j];
      const candidateSignature = `${candidate.stage}\u0000${candidate.message}`;
      if (candidateSignature !== signature) {
        break;
      }
      group.push(candidate);
      j += 1;
    }

    const canBundle =
      group.length > 1 && group.every((log) => !isErrorLikeLog(log));
    if (canBundle) {
      lines.push(formatBundledLogLine(group));
    } else {
      for (const log of group) {
        lines.push(formatLogLine(log));
      }
    }

    i = j - 1;
  }

  return lines;
}

function getVisibleLogLines(logs) {
  return showUnbundledLogs
    ? buildUnbundledLogLines(logs)
    : buildRenderedLogLines(logs);
}

function renderLoadedLogs(logs) {
  latestLoadedLogs = Array.isArray(logs) ? logs : [];

  if (!latestLoadedLogs.length) {
    renderEmptyLogsState();
    setStatus(UI_MESSAGES.logs.logCount(0), true);
    updateViewToggleButton();
    return;
  }

  const lines = getVisibleLogLines(latestLoadedLogs);

  ensureLogsStructure();
  logsEl.classList.remove("empty-state");
  logsEl.classList.add("has-logs");
  logsMascotEl.src = getLogsEmptyMascotSrc(themeMode);
  logsContentEl.textContent = lines.join("\n");
  setStatus(UI_MESSAGES.logs.logCount(lines.length), true);
  updateViewToggleButton();
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
    logs = await withTimeout(idbGetLogs(DB.logMaxItems), LOGS_LOAD_TIMEOUT_MS);
  } catch {
    latestLoadedLogs = [];
    renderEmptyLogsState();
    setStatus(UI_MESSAGES.logs.failedToLoad);
    updateViewToggleButton();
    return;
  }
  renderLoadedLogs(logs);
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
  updateViewToggleButton();
}

refreshBtn?.addEventListener("click", () => {
  void renderLogs();
});

clearBtn?.addEventListener("click", async () => {
  await idbClearLogs();
  setStatus(UI_MESSAGES.logs.logsCleared, true);
  await renderLogs();
});

viewToggleBtn?.addEventListener("click", () => {
  showUnbundledLogs = !showUnbundledLogs;
  renderLoadedLogs(latestLoadedLogs);
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
  updateViewToggleButton();
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
