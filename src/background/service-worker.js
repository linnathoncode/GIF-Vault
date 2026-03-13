import { STORAGE_KEYS, CONTEXT_MENU } from "../lib/settings.js";
import { safeLog } from "../lib/log.js";
import {
  setActionIcon,
  showBadgeFallback,
  syncActionIconToTheme,
} from "./action-icon.js";
import { importFromUrl, terminateImport } from "./import-service.js";
import { resolveMediaUrl } from "./media-resolver.js";

// Service worker lifecycle and browser event wiring.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU.addToVaultId,
    title: "Add to GIF Vault",
    contexts: ["image", "video"],
  });
  void syncActionIconToTheme();
});

chrome.runtime.onStartup.addListener(() => {
  void syncActionIconToTheme();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.themeMode]) {
    return;
  }

  const nextTheme =
    changes[STORAGE_KEYS.themeMode].newValue === "dark" ? "dark" : "light";
  void setActionIcon(nextTheme);
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU.addToVaultId || !info.srcUrl) {
    return;
  }

  try {
    await safeLog("context-menu", "Context menu click received", {
      srcUrl: info.srcUrl,
      pageUrl: info.pageUrl || "",
    });
    await importFromUrl(info.srcUrl, info.pageUrl || "");
    await showBadgeFallback(true);
  } catch (error) {
    if (String(error?.message || "").startsWith("Host access needed for ")) {
      await openPermissionAssist(info.srcUrl, info.pageUrl || "", error.message);
    }
    await showBadgeFallback(false);
    await safeLog("context-menu", "Context menu import failed", {
      error: error?.message || "unknown",
    });
  }
});

// Runtime message routing.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "SET_THEME_ICON") {
    handleThemeIconMessage(message, sendResponse);
    return true;
  }

  if (message.type === "RESOLVE_MEDIA_URL") {
    resolveMediaUrl(message.url || "")
      .then((resolvedMediaUrl) => sendResponse({ ok: true, resolvedMediaUrl }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Resolve failed" }),
      );
    return true;
  }

  if (message.type === "TERMINATE_IMPORT") {
    terminateImport(message.requestId || "")
      .then((terminated) => sendResponse({ ok: true, terminated }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error?.message || "Terminate failed",
        }),
      );
    return true;
  }

  if (message.type !== "IMPORT_URL") {
    return;
  }

  importFromUrl(
    message.url,
    message.pageUrl || "",
    message.requestId || "",
    message.resolvedMediaUrl || "",
  )
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || "Import failed" }),
    );
  return true;
});

function handleThemeIconMessage(message, sendResponse) {
  const theme = message.theme === "dark" ? "dark" : "light";
  void safeLog("theme", "SET_THEME_ICON request received", { theme });
  setActionIcon(theme)
    .then(() => sendResponse({ ok: true }))
    .catch(async (error) => {
      await safeLog("theme", "SET_THEME_ICON failed", {
        theme,
        error: error?.message || "unknown",
      });
      sendResponse({
        ok: false,
        error: error?.message || "Failed to set icon",
      });
    });
}

// Permission-assist handoff.
async function openPermissionAssist(url, pageUrl, reason) {
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
