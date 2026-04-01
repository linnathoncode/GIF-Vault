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
import { importFromUrl, terminateImport } from "./import-service.js";
import { resolveMediaUrls } from "./media-resolver.js";

let localeReadyPromise = null;
const CONTEXT_MENU_DUPLICATE_ID_FRAGMENT = "duplicate id";

function ensureLocaleReady(localeHint = "") {
  if (!localeHint && localeReadyPromise) {
    return localeReadyPromise;
  }

  localeReadyPromise = initializeI18n(
    localeHint
      ? {
          localeHint,
          useStoredLocale: false,
          persistDetectedLocale: false,
        }
      : {},
  ).catch(() => null);
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

void ensureLocaleReady();

function isTrustedRuntimeSender(sender) {
  return sender?.id === chrome.runtime.id;
}

// Service worker lifecycle and browser event wiring.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureLocaleReady();
    await createContextMenuSafely();
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

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU.addToVaultId || !info.srcUrl) {
    return;
  }
  await ensureLocaleReady();

  try {
    await safeLog("context-menu", "Context menu click received", {
      srcUrl: info.srcUrl,
      pageUrl: info.pageUrl || "",
    });
    await importFromUrl(info.srcUrl, info.pageUrl || "");
    await showBadgeFallback(true);
  } catch (error) {
    if (
      getImportErrorCode(error) === IMPORT_ERROR_CODES.hostAccessRequired ||
      String(error?.message || "") === UI_MESSAGES.import.hostAccessRequired
    ) {
      await openPermissionAssist(info.srcUrl, info.pageUrl || "");
    }
    await showBadgeFallback(false);
    await safeLog("context-menu", "Context menu import failed", {
      error: error?.message || "unknown",
    });
  }
});

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
