import { idbGetLogs, idbClearLogs } from "../../lib/db.js";
import { DB } from "../../lib/settings.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import { withTimeout } from "../../lib/async.js";
import { formatBytes } from "../../lib/ui.js";
import { safeStringifyLogValue } from "../../lib/log.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setToolbarIcon,
} from "../../lib/theme.js";
import { addThemeLocaleStorageListener } from "../../lib/page-lifecycle.js";
import {
  formatLogExportLine,
  formatLogsStatusCount,
  getVisibleLogLines,
} from "./logs-format.js";
import {
  buildLogsAttachmentName,
  buildReportLogsAttachmentText,
  openBugReportDraft,
  triggerAttachmentDownload,
} from "./logs-report.js";
import { createLogsViewController } from "./logs-view.js";

const refs = {
  logsEl: document.getElementById("logs"),
  statusEl: document.getElementById("status"),
  storageUsageEl: document.getElementById("storageUsage"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearBtn: document.getElementById("clearBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  themeToggleIcon: document.getElementById("themeToggleIcon"),
  viewToggleBtn: document.getElementById("viewToggleBtn"),
  viewToggleIcon: document.getElementById("viewToggleIcon"),
  reportBugBtn: document.getElementById("reportBugBtn"),
  reportPanel: document.getElementById("reportPanel"),
  wrapEl:
    typeof document?.querySelector === "function"
      ? document.querySelector(".wrap")
      : null,
  sendReportBtn: document.getElementById("sendReportBtn"),
  bugDescriptionLabel: document.getElementById("bugDescriptionLabel"),
  bugDescriptionInput: document.getElementById("bugDescriptionInput"),
  reportAttachmentHint: document.getElementById("reportAttachmentHint"),
  reportStatusEl: document.getElementById("reportStatus"),
};

const view = createLogsViewController({
  refs,
  UI_MESSAGES,
  getVisibleLogLines,
  formatLogsStatusCount,
  safeStringifyLogValue,
});

let themeMode = "light";
let localeApplyVersion = 0;
const INIT_STEP_TIMEOUT_MS = 3000;
const STORAGE_ESTIMATE_TIMEOUT_MS = 2500;
const LOGS_LOAD_TIMEOUT_MS = 4000;
const BUG_REPORT_SUPPORT_EMAIL = "gifvault.support@gmail.com";

function invalidatePendingLocaleApply() {
  localeApplyVersion += 1;
}

async function renderStorageEstimate() {
  if (!refs.storageUsageEl) {
    return;
  }

  if (!navigator.storage || typeof navigator.storage.estimate !== "function") {
    refs.storageUsageEl.textContent = UI_MESSAGES.logs.storageEstimateApiUnavailable;
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
    refs.storageUsageEl.textContent = UI_MESSAGES.logs.storageUsage(
      formatBytes(usedSpace, ["B", "KB", "MB", "GB", "TB"]),
      formatBytes(totalSpace, ["B", "KB", "MB", "GB", "TB"]),
    );
  } catch {
    refs.storageUsageEl.textContent = UI_MESSAGES.logs.storageEstimateFailed;
  }
}

async function renderLogs() {
  if (!refs.logsEl) {
    view.setStatus(UI_MESSAGES.logs.failedToLoad);
    return;
  }

  await renderStorageEstimate();
  try {
    const logs = await withTimeout(idbGetLogs(DB.logMaxItems), LOGS_LOAD_TIMEOUT_MS);
    view.renderLoadedLogs(logs);
  } catch {
    view.renderEmptyLogsState();
    view.setStatus(UI_MESSAGES.logs.failedToLoad);
    view.updateViewToggleButton();
  }
}

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  void setToolbarIcon(theme);
  if (refs.themeToggleIcon) {
    const themeIcon =
      theme === "dark" ? "icon-theme-light.svg" : "icon-theme-moon.svg";
    refs.themeToggleIcon.src = `../../assets/shared/${themeIcon}`;
  }
  themeMode = theme;
  view.applyTheme(theme);
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
  view.syncLocaleDecorations();
}

function handleSendReport() {
  const description = String(refs.bugDescriptionInput?.value || "").trim();
  if (!description) {
    view.setReportStatus(UI_MESSAGES.logs.reportDescriptionRequired);
    refs.bugDescriptionInput?.focus();
    return;
  }

  view.setReportStatus(UI_MESSAGES.logs.reportPreparing);
  if (refs.sendReportBtn) {
    refs.sendReportBtn.disabled = true;
  }
  try {
    const manifest = globalThis.chrome?.runtime?.getManifest?.();
    const extensionVersion = String(manifest?.version || "unknown");
    const latestLoadedLogs = view.getLatestLoadedLogs();
    const attachmentText = buildReportLogsAttachmentText({
      logs: latestLoadedLogs,
      extensionVersion,
      formatLogExportLine,
    });
    const attachmentName = buildLogsAttachmentName();
    triggerAttachmentDownload(attachmentName, attachmentText);
    openBugReportDraft({
      description,
      attachmentName,
      logCount: latestLoadedLogs.length,
      UI_MESSAGES,
      supportEmail: BUG_REPORT_SUPPORT_EMAIL,
    });
    view.setReportStatus(UI_MESSAGES.logs.reportEmailOpened(attachmentName), true);
  } catch {
    view.setReportStatus(UI_MESSAGES.logs.reportFailed);
  } finally {
    if (refs.sendReportBtn) {
      refs.sendReportBtn.disabled = false;
    }
  }
}

refs.refreshBtn?.addEventListener("click", () => {
  void renderLogs();
});

refs.clearBtn?.addEventListener("click", async () => {
  await idbClearLogs();
  view.setStatus(UI_MESSAGES.logs.logsCleared, true);
  await renderLogs();
});

refs.reportBugBtn?.addEventListener("click", () => {
  if (view.getIsReportComposerOpen()) {
    refs.bugDescriptionInput?.focus();
    return;
  }
  view.setReportComposerOpen(true);
  refs.bugDescriptionInput?.focus();
});

refs.sendReportBtn?.addEventListener("click", handleSendReport);

refs.viewToggleBtn?.addEventListener("click", () => {
  view.toggleViewMode();
});

refs.themeToggleBtn?.addEventListener("click", async () => {
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
  view.ensureLogsStructure();
  view.setReportComposerOpen(false);
  view.updateViewToggleButton();
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
  view.ensureLogsStructure();
  view.renderEmptyLogsState();
  view.setStatus(UI_MESSAGES.logs.failedToLoad);
});
