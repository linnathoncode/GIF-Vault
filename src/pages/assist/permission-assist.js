import { STORAGE_KEYS } from "../../lib/settings.js";
import { safeLog } from "../../lib/log.js";
import { originPatternFromUrl } from "../../lib/ui.js";
import { applyDocumentTheme } from "../../lib/theme.js";

const reasonEl = document.getElementById("reason");
const originsEl = document.getElementById("origins");
const originsListEl = document.getElementById("originsList");
const statusEl = document.getElementById("status");
const grantBtn = document.getElementById("grantBtn");
const cancelBtn = document.getElementById("cancelBtn");

const params = new URLSearchParams(window.location.search);
const importUrl = (params.get("url") || "").trim();
const pageUrl = (params.get("pageUrl") || "").trim();
const reason = (params.get("reason") || "Additional host access is required.").trim();

let pendingOrigins = [];
let isBusy = false;

init().catch(async (error) => {
  setStatus(error?.message || "Failed to prepare permission request.", "error");
  grantBtn.disabled = true;
  await safeLog("permissions", "Permission assist failed to initialize", {
    error: error?.message || "unknown",
    url: importUrl
  });
});

grantBtn.addEventListener("click", () => {
  void grantAndImport();
});

cancelBtn.addEventListener("click", () => {
  window.close();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.themeMode]) {
    return;
  }
  applyTheme(changes[STORAGE_KEYS.themeMode].newValue);
});

async function init() {
  if (!importUrl) {
    throw new Error("Missing import URL.");
  }

  const currentTheme = await chrome.storage.local.get([STORAGE_KEYS.themeMode]);
  applyTheme(currentTheme[STORAGE_KEYS.themeMode]);

  reasonEl.textContent = reason;
  pendingOrigins = await collectMissingOrigins(importUrl);
  renderOrigins(pendingOrigins);

  if (pendingOrigins.length === 0) {
    grantBtn.textContent = "Import";
    setStatus("Access is already granted. Start the import.", "");
  } else {
    grantBtn.textContent = "Grant & Import";
    setStatus("Grant access, then GIF Vault will import automatically.", "");
  }

  grantBtn.disabled = false;
}

async function collectMissingOrigins(url) {
  const resolution = await chrome.runtime.sendMessage({
    type: "RESOLVE_MEDIA_URL",
    url
  }).catch(() => ({ ok: false, resolvedMediaUrl: "" }));

  const origins = new Set([
    originPatternFromUrl(url),
    originPatternFromUrl(pageUrl),
    originPatternFromUrl(resolution?.ok ? resolution.resolvedMediaUrl || "" : "")
  ]);

  const missing = [];
  for (const origin of origins) {
    if (!origin) {
      continue;
    }
    const hasAccess = await chrome.permissions.contains({ origins: [origin] });
    if (!hasAccess) {
      missing.push(origin);
    }
  }
  return missing;
}

async function grantAndImport() {
  if (isBusy) {
    return;
  }
  isBusy = true;
  grantBtn.disabled = true;
  cancelBtn.disabled = true;

  try {
    if (pendingOrigins.length > 0) {
      setStatus("Waiting for permission grant...", "");
      const granted = await chrome.permissions.request({ origins: pendingOrigins });
      if (!granted) {
        await safeLog("permissions", "Optional host access denied", { origins: pendingOrigins });
        setStatus("Access was not granted.", "error");
        return;
      }
      await safeLog("permissions", "Optional host access granted", { origins: pendingOrigins });
    }

    setStatus("Importing media...", "");
    const requestId = crypto.randomUUID();
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_URL",
      url: importUrl,
      pageUrl,
      requestId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import failed");
    }

    const convertedMessage = response.result?.converted ? " (converted)" : "";
    setStatus(`Imported successfully${convertedMessage}. Closing...`, "ok");
    await safeLog("permissions", "Assist import completed", {
      url: importUrl,
      converted: Boolean(response.result?.converted)
    });
    await closeCurrentTabSoon();
  } catch (error) {
    await safeLog("permissions", "Assist import failed", {
      url: importUrl,
      error: error?.message || "unknown"
    });
    setStatus(error?.message || "Import failed.", "error");
  } finally {
    isBusy = false;
    grantBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

function renderOrigins(origins) {
  originsListEl.innerHTML = "";
  if (!origins.length) {
    originsEl.hidden = true;
    return;
  }
  originsEl.hidden = false;
  for (const origin of origins) {
    const item = document.createElement("li");
    item.textContent = origin;
    originsListEl.appendChild(item);
  }
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function applyTheme(mode) {
  applyDocumentTheme(mode);
}

async function closeCurrentTabSoon() {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const currentTab = await chrome.tabs.getCurrent();
  if (currentTab?.id) {
    await chrome.tabs.remove(currentTab.id);
    return;
  }
  window.close();
}

