import { idbGetLogs, idbClearLogs } from "../lib/db.js";
import { STORAGE_KEYS } from "../lib/settings.js";
import { formatBytes } from "../lib/ui.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setThemeToggleGlyph,
  setToolbarIcon
} from "../lib/theme.js";

const logsEl = document.getElementById("logs");
const statusEl = document.getElementById("status");
const storageUsageEl = document.getElementById("storageUsage");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

let themeMode = "light";

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status";
}

async function renderStorageEstimate() {
  if (!storageUsageEl) {
    return;
  }

  if (!navigator.storage || typeof navigator.storage.estimate !== "function") {
    storageUsageEl.textContent = "Storage: estimate API unavailable";
    return;
  }

  try {
    const quota = await navigator.storage.estimate();
    const totalSpace = quota.quota || 0;
    const usedSpace = quota.usage || 0;
    storageUsageEl.textContent = `Storage: ${formatBytes(usedSpace, ["B", "KB", "MB", "GB", "TB"])} used / ${formatBytes(totalSpace, ["B", "KB", "MB", "GB", "TB"])} total`;
  } catch {
    storageUsageEl.textContent = "Storage: estimate failed";
  }
}

async function renderLogs() {
  await renderStorageEstimate();
  const logs = await idbGetLogs(500);
  if (!logs.length) {
    logsEl.textContent = "No logs yet.";
    setStatus("0 logs", true);
    return;
  }

  const lines = logs.map((log) => {
    const when = new Date(log.createdAt || Date.now()).toLocaleTimeString();
    const details = log.details ? ` ${JSON.stringify(log.details)}` : "";
    return `[${when}] ${log.stage}: ${log.message}${details}`;
  });

  logsEl.textContent = lines.join("\n");
  setStatus(`${logs.length} logs`, true);
}

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  void setToolbarIcon(theme);
  setThemeToggleGlyph(themeToggleBtn, theme);
  themeMode = theme;
}

refreshBtn.addEventListener("click", () => {
  void renderLogs();
});

clearBtn.addEventListener("click", async () => {
  await idbClearLogs();
  setStatus("Logs cleared.", true);
  await renderLogs();
});

themeToggleBtn.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setThemeMode(themeMode);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.themeMode]) {
    return;
  }
  const next = changes[STORAGE_KEYS.themeMode].newValue === "dark" ? "dark" : "light";
  applyTheme(next);
});

async function init() {
  applyTheme(await getThemeMode());
  await renderLogs();
}

init();
