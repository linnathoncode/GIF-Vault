import { STORAGE_KEYS, CONTEXT_MENU } from "../lib/settings.js";
import { safeLog } from "../lib/log.js";
import { UI_MESSAGES } from "../lib/messages.js";
import { initializeI18n } from "../lib/i18n.js";
import {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
  isRuntimeMessage,
  getImportErrorCode,
} from "../lib/protocol.js";
import {
  showBadgeFallback,
} from "./action-icon.js";
import { importFromFiles, importFromUrl, terminateImport } from "./import-service.js";
import { resolveMediaUrls } from "./media-resolver.js";

let localeReadyPromise = null;
const CONTEXT_MENU_DUPLICATE_ID_FRAGMENT = "duplicate id";
const INSTAGRAM_POST_PATH_PATTERN = /^\/(?:p|reel|tv)\//i;

function ensureLocaleReady(localeHint = "") {
  const initOptions = localeHint
    ? {
        localeHint,
        useStoredLocale: false,
        persistDetectedLocale: false,
      }
    : {};

  localeReadyPromise = (localeReadyPromise || Promise.resolve())
    .catch(() => null)
    .then(() => initializeI18n(initOptions))
    .catch(() => null);
  return localeReadyPromise;
}

async function updateContextMenuTitle() {
  try {
    await chrome.contextMenus.update(CONTEXT_MENU.addToVaultId, {
      title: UI_MESSAGES.serviceWorker.contextMenuAddToVault,
    });
  } catch {
    // no-op
  }

  try {
    await chrome.contextMenus.update(CONTEXT_MENU.addToVaultInstagramPageId, {
      title: UI_MESSAGES.serviceWorker.contextMenuAddToVault,
    });
  } catch {
    // no-op
  }
}

function createContextMenuSafely() {
  return new Promise((resolve, reject) => {
    try {
      chrome.contextMenus.create(
        {
          id: CONTEXT_MENU.addToVaultId,
          title: UI_MESSAGES.serviceWorker.contextMenuAddToVault,
          contexts: ["image", "video"],
        },
        () => {
          const runtimeError = chrome.runtime?.lastError;
          if (!runtimeError) {
            resolve();
            return;
          }
          const errorMessage = String(runtimeError.message || "");
          if (
            errorMessage
              .toLowerCase()
              .includes(CONTEXT_MENU_DUPLICATE_ID_FRAGMENT)
          ) {
            resolve();
            return;
          }
          reject(new Error(errorMessage || "Failed to create context menu"));
        },
      );
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (
        errorMessage.toLowerCase().includes(CONTEXT_MENU_DUPLICATE_ID_FRAGMENT)
      ) {
        resolve();
        return;
      }
      reject(error);
    }
  });
}

function createInstagramPageContextMenuSafely() {
  return new Promise((resolve, reject) => {
    try {
      chrome.contextMenus.create(
        {
          id: CONTEXT_MENU.addToVaultInstagramPageId,
          title: UI_MESSAGES.serviceWorker.contextMenuAddToVault,
          contexts: ["page"],
          documentUrlPatterns: ["https://*.instagram.com/*"],
        },
        () => {
          const runtimeError = chrome.runtime?.lastError;
          if (!runtimeError) {
            resolve();
            return;
          }
          const errorMessage = String(runtimeError.message || "");
          if (
            errorMessage
              .toLowerCase()
              .includes(CONTEXT_MENU_DUPLICATE_ID_FRAGMENT)
          ) {
            resolve();
            return;
          }
          reject(new Error(errorMessage || "Failed to create context menu"));
        },
      );
    } catch (error) {
      const errorMessage = String(error?.message || "");
      if (
        errorMessage.toLowerCase().includes(CONTEXT_MENU_DUPLICATE_ID_FRAGMENT)
      ) {
        resolve();
        return;
      }
      reject(error);
    }
  });
}

void ensureLocaleReady();

function isTrustedRuntimeSender(sender) {
  return sender?.id === chrome.runtime.id;
}

// Service worker lifecycle and browser event wiring.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureLocaleReady();
    await createContextMenuSafely();
    await createInstagramPageContextMenuSafely();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureLocaleReady();
    await updateContextMenuTitle();
  })();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.locale]?.newValue) {
    const nextLocale = String(changes[STORAGE_KEYS.locale].newValue || "").trim();
    void ensureLocaleReady(nextLocale).then(updateContextMenuTitle);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const isDirectMediaMenu = info.menuItemId === CONTEXT_MENU.addToVaultId;
  const isInstagramPageMenu =
    info.menuItemId === CONTEXT_MENU.addToVaultInstagramPageId;
  if (!isDirectMediaMenu && !isInstagramPageMenu) {
    return;
  }
  await ensureLocaleReady();
  let srcUrl = "";

  try {
    srcUrl = await resolveContextMenuSourceUrl(info, tab);
    if (!srcUrl) {
      return;
    }

    await safeLog("context-menu", "Context menu click received", {
      srcUrl,
      pageUrl: info.pageUrl || "",
    });
    await importFromUrl(srcUrl, info.pageUrl || "");
    await showBadgeFallback(true);
  } catch (error) {
    if (
      getImportErrorCode(error) === IMPORT_ERROR_CODES.hostAccessRequired ||
      String(error?.message || "") === UI_MESSAGES.import.hostAccessRequired
    ) {
      await openPermissionAssist(srcUrl, info.pageUrl || "");
    }
    await showBadgeFallback(false);
    await safeLog("context-menu", "Context menu import failed", {
      error: error?.message || "unknown",
    });
  }
});

async function resolveContextMenuSourceUrl(info, tab) {
  if (info?.srcUrl) {
    return info.srcUrl;
  }

  if (!isInstagramPostPageUrl(info?.pageUrl || "")) {
    await safeLog("context-menu", "No srcUrl and page is not Instagram post URL", {
      pageUrl: info?.pageUrl || "",
    });
    return "";
  }

  const fallbackPageUrl = getInstagramPostFallbackUrl(info, tab);
  const captured = await getStoredInstagramContextMedia();
  if (!captured) {
    const debugState = await getStoredInstagramContextDebug();
    await safeLog("context-menu", "No stored Instagram context media found", {
      pageUrl: info?.pageUrl || "",
      tabUrl: tab?.url || "",
      fallbackPageUrl,
      debugState,
    });
    return fallbackPageUrl;
  }

  const expectedPageUrl = String(info?.pageUrl || "");
  const tabUrl = String(tab?.url || "");
  const capturedPageUrl = String(captured.pageUrl || "");
  if (
    capturedPageUrl &&
    capturedPageUrl !== expectedPageUrl &&
    capturedPageUrl !== tabUrl
  ) {
    await safeLog("context-menu", "Stored Instagram media page mismatch", {
      expectedPageUrl,
      tabUrl,
      capturedPageUrl,
      fallbackPageUrl,
    });
    return fallbackPageUrl;
  }

  const capturedAt = Number(captured.capturedAt || 0);
  const maxAgeMs = Number(captured.maxAgeMs || 10_000);
  if (!capturedAt || Date.now() - capturedAt > maxAgeMs) {
    await safeLog("context-menu", "Stored Instagram media expired", {
      capturedAt,
      maxAgeMs,
      ageMs: capturedAt ? Date.now() - capturedAt : -1,
      fallbackPageUrl,
    });
    return fallbackPageUrl;
  }

  return String(captured.mediaUrl || "").trim();
}

function getInstagramPostFallbackUrl(info, tab) {
  const expectedPageUrl = String(info?.pageUrl || "").trim();
  if (isInstagramPostPageUrl(expectedPageUrl)) {
    return expectedPageUrl;
  }

  const tabUrl = String(tab?.url || "").trim();
  if (isInstagramPostPageUrl(tabUrl)) {
    return tabUrl;
  }

  return "";
}

function isInstagramPostPageUrl(pageUrl) {
  const value = String(pageUrl || "").trim();
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("instagram.com")) {
      return false;
    }
    return INSTAGRAM_POST_PATH_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function getStoredInstagramContextMedia() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.instagramContextMedia);
    return data?.[STORAGE_KEYS.instagramContextMedia] || null;
  } catch {
    return null;
  }
}

async function getStoredInstagramContextDebug() {
  try {
    const data = await chrome.storage.local.get("instagramContextDebug");
    const debugState = data?.instagramContextDebug || null;
    if (!debugState) {
      return null;
    }
    const capturedAt = Number(debugState.capturedAt || 0);
    const maxAgeMs = Number(debugState.maxAgeMs || 0);
    if (!capturedAt || !maxAgeMs || Date.now() - capturedAt > maxAgeMs) {
      return null;
    }
    return debugState;
  } catch {
    return null;
  }
}

// Runtime message routing.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedRuntimeSender(sender) || !isRuntimeMessage(message)) {
    return;
  }
  const localeSyncPromise = ensureLocaleReady();

  if (message.type === MESSAGE_TYPES.resolveMediaUrl) {
    localeSyncPromise
      .then(() => resolveMediaUrls(message.url || ""))
      .then((resolvedMediaUrls) =>
        sendResponse({
          ok: true,
          resolvedMediaUrl: resolvedMediaUrls[0] || "",
          resolvedMediaUrls,
        }),
      )
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || UI_MESSAGES.serviceWorker.resolveFailed,
        }),
      );
    return true;
  }

  if (message.type === MESSAGE_TYPES.terminateImport) {
    localeSyncPromise
      .then(() => terminateImport(message.requestId || ""))
      .then((terminated) => sendResponse({ ok: true, terminated }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || UI_MESSAGES.serviceWorker.terminateFailed,
        }),
      );
    return true;
  }

  if (message.type === MESSAGE_TYPES.importFiles) {
    localeSyncPromise
      .then(() =>
        importFromFiles(
          message.files || [],
          message.requestId || "",
          message.sourceUrlHint || "",
        ),
      )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || UI_MESSAGES.popup.importFailed,
          errorCode:
            getImportErrorCode(error) || inferImportErrorCode(error?.message || ""),
        }),
      );
    return true;
  }

  if (message.type !== MESSAGE_TYPES.importUrl) {
    return;
  }

  localeSyncPromise
    .then(() =>
      importFromUrl(
        message.url,
        message.pageUrl || "",
        message.requestId || "",
        message.resolvedMediaUrl || "",
      ),
    )
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error?.message || UI_MESSAGES.popup.importFailed,
        errorCode: getImportErrorCode(error) || inferImportErrorCode(error?.message || ""),
      }),
    );
  return true;
});

// Permission-assist handoff.
async function openPermissionAssist(url, pageUrl, reason = "") {
  try {
    const assistUrl = new URL(
      chrome.runtime.getURL("pages/assist/permission-assist.html"),
    );
    assistUrl.searchParams.set("url", url || "");
    if (pageUrl) {
      assistUrl.searchParams.set("pageUrl", pageUrl);
    }
    if (reason) {
      assistUrl.searchParams.set("reason", reason);
    }
    await chrome.tabs.create({ url: assistUrl.toString() });
    await safeLog("context-menu", "Opened permission assist tab", {
      url,
      pageUrl,
      reason,
    });
  } catch (error) {
    await safeLog("context-menu", "Failed to open permission assist tab", {
      error: error?.message || "unknown",
    });
  }
}

function inferImportErrorCode(rawMessage) {
  const message = String(rawMessage || "");
  if (message === UI_MESSAGES.import.hostAccessRequired) {
    return IMPORT_ERROR_CODES.hostAccessRequired;
  }
  if (message === UI_MESSAGES.import.importTerminated) {
    return IMPORT_ERROR_CODES.importTerminated;
  }
  if (message === UI_MESSAGES.import.concurrentImportInProgress) {
    return IMPORT_ERROR_CODES.concurrentImportInProgress;
  }
  return "";
}
