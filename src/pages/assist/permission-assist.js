import { STORAGE_KEYS } from "../../lib/settings.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
} from "../../lib/protocol.js";
import { originPatternFromUrl } from "../../lib/ui.js";
import { applyDocumentTheme } from "../../lib/theme.js";
import { addThemeLocaleStorageListener } from "../../lib/page-lifecycle.js";

const reasonEl = document.getElementById("reason");
const originsEl = document.getElementById("origins");
const originsListEl = document.getElementById("originsList");
const statusEl = document.getElementById("status");
const grantBtn = document.getElementById("grantBtn");
const cancelBtn = document.getElementById("cancelBtn");

const params = new URLSearchParams(window.location.search);
const importUrl = (params.get("url") || "").trim();
const pageUrl = (params.get("pageUrl") || "").trim();
const reasonHint = (params.get("reason") || "").trim();

let pendingOrigins = [];
let resolvedMediaUrls = [];
let isBusy = false;
let usingDefaultReason = false;

function setButtonLabel(button, text) {
  const labelEl = button?.querySelector?.("span");
  if (labelEl) {
    labelEl.textContent = text;
    return;
  }
  if (button) {
    button.textContent = text;
  }
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
  if (usingDefaultReason) {
    reasonEl.textContent = UI_MESSAGES.assist.defaultReason;
  }
  if (pendingOrigins.length === 0) {
    setButtonLabel(grantBtn, UI_MESSAGES.assist.importButtonIdle);
  } else {
    setButtonLabel(grantBtn, UI_MESSAGES.assist.grantAndImportButton);
  }
}

init().catch(async (error) => {
  setStatus(
    error?.message || UI_MESSAGES.assist.failedToPreparePermissionRequest,
    "error",
  );
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

addThemeLocaleStorageListener({
  onThemeChange(nextTheme) {
    applyTheme(nextTheme);
  },
  onLocaleChange(nextLocale) {
    void applyLocale(nextLocale);
  },
});

async function init() {
  await applyLocale();

  if (!importUrl) {
    throw new Error(UI_MESSAGES.assist.missingImportUrl);
  }

  const currentTheme = await chrome.storage.local.get([STORAGE_KEYS.themeMode]);
  applyTheme(currentTheme[STORAGE_KEYS.themeMode]);

  const reason = (reasonHint || UI_MESSAGES.assist.defaultReason).trim();
  usingDefaultReason = !reasonHint;
  reasonEl.textContent = reason;
  reasonEl.hidden = false;
  pendingOrigins = await collectMissingOrigins(importUrl);
  renderOrigins(pendingOrigins);

  if (pendingOrigins.length === 0) {
    setButtonLabel(grantBtn, UI_MESSAGES.assist.importButtonIdle);
    setStatus(UI_MESSAGES.assist.accessAlreadyGranted, "");
  } else {
    setButtonLabel(grantBtn, UI_MESSAGES.assist.grantAndImportButton);
    setStatus(UI_MESSAGES.assist.grantThenImport, "");
  }

  grantBtn.disabled = false;
}

async function collectMissingOrigins(url) {
  const resolution = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.resolveMediaUrl,
    url
  }).catch(() => ({ ok: false, resolvedMediaUrl: "" }));

  resolvedMediaUrls = Array.isArray(resolution?.resolvedMediaUrls)
    ? resolution.resolvedMediaUrls.filter(Boolean)
    : [];

  const origins = new Set([
    originPatternFromUrl(url),
    originPatternFromUrl(pageUrl),
    originPatternFromUrl(resolution?.ok ? resolution.resolvedMediaUrl || "" : ""),
    ...resolvedMediaUrls.map((mediaUrl) => originPatternFromUrl(mediaUrl)),
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
      setStatus(UI_MESSAGES.assist.waitingForPermissionGrant, "");
      const granted = await chrome.permissions.request({ origins: pendingOrigins });
      if (!granted) {
        await safeLog("permissions", "Optional host access denied", { origins: pendingOrigins });
        setStatus(UI_MESSAGES.assist.accessNotGranted, "error");
        return;
      }
      await safeLog("permissions", "Optional host access granted", { origins: pendingOrigins });
    }

    setStatus(UI_MESSAGES.assist.importingMedia, "");
    const requestId = crypto.randomUUID();
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.importUrl,
      url: importUrl,
      pageUrl,
      requestId,
      resolvedMediaUrl: resolvedMediaUrls,
    });

    if (!response?.ok) {
      const error = new Error(response?.error || UI_MESSAGES.popup.importFailed);
      error.code = String(response?.errorCode || "");
      throw error;
    }

    const importedCount = Number(response.result?.importedCount) || 1;
    const convertedCount = Number(response.result?.convertedCount) || 0;
    const successMessage = buildImportSuccessMessage(importUrl, importedCount, convertedCount);
    setStatus(`${successMessage} ${UI_MESSAGES.assist.closingSuffix}`, "ok");
    await safeLog("permissions", "Assist import completed", {
      url: importUrl,
      converted: Boolean(response.result?.converted)
    });
    await closeCurrentTabSoon();
  } catch (error) {
    if (String(error?.code || "") === IMPORT_ERROR_CODES.hostAccessRequired) {
      setStatus(UI_MESSAGES.assist.grantThenImport, "error");
      return;
    }
    await safeLog("permissions", "Assist import failed", {
      url: importUrl,
      error: error?.message || "unknown"
    });
    setStatus(error?.message || UI_MESSAGES.assist.importFailedWithPeriod, "error");
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

function isTweetUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).host.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  } catch {
    return false;
  }
}

function buildImportSuccessMessage(sourceUrl, importedCount, convertedCount) {
  const parts = [];
  if (importedCount > 1 && isTweetUrl(sourceUrl)) {
    parts.push(UI_MESSAGES.popup.successTweetMany(importedCount));
  }

  if (importedCount > 1) {
    parts.push(UI_MESSAGES.popup.successImportedMany(importedCount));
  } else {
    parts.push(UI_MESSAGES.popup.successImportedSingle);
  }

  if (convertedCount > 1) {
    parts.push(UI_MESSAGES.popup.successConvertedMany(convertedCount));
  } else if (convertedCount === 1 && importedCount > 1) {
    parts.push(UI_MESSAGES.popup.successConvertedSingleInBatch);
  } else if (convertedCount === 1) {
    parts.push(UI_MESSAGES.popup.successConvertedSingle);
  }

  return parts.join(" ");
}

