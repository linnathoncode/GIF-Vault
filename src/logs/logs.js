import { idbGetLogs, idbClearLogs } from "../lib/db.js";
import { STORAGE_KEYS } from "../lib/settings.js";

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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
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
    storageUsageEl.textContent = `Storage: ${formatBytes(usedSpace)} used / ${formatBytes(totalSpace)} total`;
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
  const theme = mode === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "\u2600" : "\u263E";
  }
  themeMode = theme;
}

function getTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.themeMode], (result) => {
      resolve(result[STORAGE_KEYS.themeMode] === "dark" ? "dark" : "light");
    });
  });
}

function setTheme(theme) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.themeMode]: theme }, resolve);
  });
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
  await setTheme(themeMode);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.themeMode]) {
    return;
  }
  const next = changes[STORAGE_KEYS.themeMode].newValue === "dark" ? "dark" : "light";
  applyTheme(next);
});

async function init() {
  applyTheme(await getTheme());
  await renderLogs();
}

init();
