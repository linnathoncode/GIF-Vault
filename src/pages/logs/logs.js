import { idbGetLogs, idbClearLogs } from "../../lib/db.js";
import { DB } from "../../lib/settings.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import { formatBytes } from "../../lib/ui.js";
import { safeStringifyLogValue } from "../../lib/log.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setToolbarIcon
} from "../../lib/theme.js";
import { addThemeLocaleStorageListener } from "../../lib/page-lifecycle.js";

const logsEl = document.getElementById("logs");
const statusEl = document.getElementById("status");
const storageUsageEl = document.getElementById("storageUsage");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const viewToggleBtn = document.getElementById("viewToggleBtn");
const viewToggleIcon = document.getElementById("viewToggleIcon");
const reportBugBtn = document.getElementById("reportBugBtn");
const reportPanel = document.getElementById("reportPanel");
const wrapEl =
  typeof document?.querySelector === "function"
    ? document.querySelector(".wrap")
    : null;
const sendReportBtn = document.getElementById("sendReportBtn");
const bugDescriptionLabel = document.getElementById("bugDescriptionLabel");
const bugDescriptionInput = document.getElementById("bugDescriptionInput");
const reportAttachmentHint = document.getElementById("reportAttachmentHint");
const reportStatusEl = document.getElementById("reportStatus");

let themeMode = "light";
let logsMascotEl = null;
let logsContentEl = null;
let localeApplyVersion = 0;
let latestLoadedLogs = [];
let showUnbundledLogs = false;
const INIT_STEP_TIMEOUT_MS = 3000;
const STORAGE_ESTIMATE_TIMEOUT_MS = 2500;
const LOGS_LOAD_TIMEOUT_MS = 4000;
const BUG_REPORT_SUPPORT_EMAIL = "gifvault.support@gmail.com";
const LOG_ERROR_HINT_REGEX = /\b(failed|error|rejected|denied|invalid|missing|timeout|aborted|abort|unable|could not)\b/i;
let isReportComposerOpen = false;

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
  const labelEl =
    typeof viewToggleBtn.querySelector === "function"
      ? viewToggleBtn.querySelector("span")
      : null;
  if (labelEl) {
    labelEl.textContent = label;
  } else {
    viewToggleBtn.textContent = label;
  }
  if (viewToggleIcon) {
    viewToggleIcon.src = showUnbundledLogs
      ? "../../assets/shared/icon-view-bundle.svg"
      : "../../assets/shared/icon-view-expand.svg";
  }
  viewToggleBtn.title = label;
  viewToggleBtn.setAttribute("aria-label", label);
  viewToggleBtn.disabled = latestLoadedLogs.length === 0;
}

function setReportStatus(text, ok = false) {
  if (!reportStatusEl) {
    return;
  }
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    reportStatusEl.textContent = "";
    reportStatusEl.className = "status";
    reportStatusEl.hidden = true;
    return;
  }
  reportStatusEl.textContent = text;
  reportStatusEl.className = ok ? "status ok" : "status";
  reportStatusEl.hidden = false;
}

function setReportComposerOpen(open) {
  isReportComposerOpen = Boolean(open);
  if (reportBugBtn) {
    const labelEl =
      typeof reportBugBtn.querySelector === "function"
        ? reportBugBtn.querySelector("span")
        : null;
    if (labelEl) {
      labelEl.textContent = UI_MESSAGES.logs.reportBugButtonCollapsed;
    } else {
      reportBugBtn.textContent = UI_MESSAGES.logs.reportBugButtonCollapsed;
    }
  }
  if (reportPanel) {
    reportPanel.hidden = !isReportComposerOpen;
  }
  wrapEl?.classList.toggle("report-open", isReportComposerOpen);
  if (reportAttachmentHint) {
    reportAttachmentHint.hidden = !isReportComposerOpen;
  }
  if (bugDescriptionLabel) {
    bugDescriptionLabel.hidden = false;
  }
  if (bugDescriptionInput) {
    bugDescriptionInput.hidden = false;
  }
  if (!isReportComposerOpen) {
    setReportStatus("");
  }
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
  const details = log.details ? ` ${safeStringifyLogValue(log.details)}` : "";
  return `[${when}] ${log.stage}: ${log.message}${details}`;
}

function formatLogExportLine(log) {
  const when = new Date(log?.createdAt || Date.now()).toISOString();
  const stage = String(log?.stage || "unknown");
  const message = String(log?.message || "");
  const details = log?.details ? ` ${JSON.stringify(log.details)}` : "";
  return `[${when}] ${stage}: ${message}${details}`;
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

function buildExportLogLines(logs) {
  return buildUnbundledLogLines(logs);
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
    ? buildExportLogLines(logs)
    : buildRenderedLogLines(logs);
}

function formatLogsStatusCount(visibleCount, totalCount) {
  const safeVisibleCount = Math.max(0, Number(visibleCount) || 0);
  const safeTotalCount = Math.max(0, Number(totalCount) || 0);
  if (safeTotalCount > safeVisibleCount) {
    return UI_MESSAGES.logs.logCountWithTotal(safeVisibleCount, safeTotalCount);
  }
  return UI_MESSAGES.logs.logCount(safeVisibleCount);
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
  setStatus(formatLogsStatusCount(lines.length, latestLoadedLogs.length), true);
  updateViewToggleButton();
}

function buildReportLogsAttachmentText(logs) {
  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  const extensionVersion = String(manifest?.version || "unknown");
  const lines = Array.isArray(logs) ? logs.map((log) => formatLogExportLine(log)) : [];
  const headerLines = [
    "GIF Vault Bug Report Logs",
    `Generated At (UTC): ${new Date().toISOString()}`,
    `Extension Version: ${extensionVersion}`,
    `Log Count: ${lines.length}`,
    "----------------------------------------",
  ];
  return `${headerLines.join("\n")}\n${lines.join("\n")}\n`;
}

function buildLogsAttachmentName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `gif-vault-logs-${stamp}.txt`;
}

function triggerAttachmentDownload(name, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function openBugReportDraft(description, attachmentName, logCount) {
  const safeDescription = description || UI_MESSAGES.logs.reportDescriptionDefault;
  const subject = UI_MESSAGES.logs.reportEmailSubject;
  const body = UI_MESSAGES.logs.reportEmailBody(
    safeDescription,
    attachmentName,
    logCount,
  );
  const composeUrl = new URL("https://mail.google.com/mail/");
  composeUrl.searchParams.set("view", "cm");
  composeUrl.searchParams.set("fs", "1");
  composeUrl.searchParams.set("tf", "1");
  composeUrl.searchParams.set("to", BUG_REPORT_SUPPORT_EMAIL);
  composeUrl.searchParams.set("su", subject);
  composeUrl.searchParams.set("body", body);
  globalThis.open(composeUrl.toString(), "_blank", "noopener,noreferrer");
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
  if (themeToggleIcon) {
    const themeIcon =
      theme === "dark" ? "icon-theme-light.svg" : "icon-theme-moon.svg";
    themeToggleIcon.src = `../../assets/shared/${themeIcon}`;
  }
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
  setReportComposerOpen(isReportComposerOpen);
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

function handleSendReport() {
  const description = String(bugDescriptionInput?.value || "").trim();
  if (!description) {
    setReportStatus(UI_MESSAGES.logs.reportDescriptionRequired);
    bugDescriptionInput?.focus();
    return;
  }

  setReportStatus(UI_MESSAGES.logs.reportPreparing);
  if (sendReportBtn) {
    sendReportBtn.disabled = true;
  }
  try {
    const attachmentText = buildReportLogsAttachmentText(latestLoadedLogs);
    const attachmentName = buildLogsAttachmentName();
    triggerAttachmentDownload(attachmentName, attachmentText);
    openBugReportDraft(description, attachmentName, latestLoadedLogs.length);
    setReportStatus(UI_MESSAGES.logs.reportEmailOpened(attachmentName), true);
  } catch {
    setReportStatus(UI_MESSAGES.logs.reportFailed);
  } finally {
    if (sendReportBtn) {
      sendReportBtn.disabled = false;
    }
  }
}

reportBugBtn?.addEventListener("click", () => {
  if (isReportComposerOpen) {
    bugDescriptionInput?.focus();
    return;
  }
  setReportComposerOpen(true);
  bugDescriptionInput?.focus();
});

sendReportBtn?.addEventListener("click", handleSendReport);

viewToggleBtn?.addEventListener("click", () => {
  showUnbundledLogs = !showUnbundledLogs;
  renderLoadedLogs(latestLoadedLogs);
});

themeToggleBtn?.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setThemeMode(themeMode);
});

addThemeLocaleStorageListener({
  onThemeChange(nextTheme) {
    const next = nextTheme === "dark" ? "dark" : "light";
    applyTheme(next);
  },
  onLocaleChange(nextLocale) {
    void (async () => {
      await applyLocale(nextLocale);
      await renderLogs();
    })();
  },
});

async function init() {
  ensureLogsStructure();
  setReportComposerOpen(false);
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
