import { safeLog } from "../../../lib/log.js";
import { UI_MESSAGES } from "../../../lib/messages.js";
import {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
} from "../../../lib/protocol.js";
import { isValidUrl, originPatternFromUrl } from "../../../lib/ui.js";

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

async function findMissingOrigins(origins) {
  const missing = [];
  for (const origin of origins) {
    if (!origin) {
      continue;
    }
    const hasAccess = await chrome.permissions.contains({
      origins: [origin],
    });
    if (!hasAccess) {
      missing.push(origin);
    }
  }
  return missing;
}

export function createPopupImportController({
  refs,
  state,
  stateStore,
  statusController,
  gridController,
  syncImportUiState,
  clearStoredImportStatePreservingUi,
}) {
  async function openPermissionAssist(url, pageUrl, missingOrigins) {
    const assistUrl = new URL(
      chrome.runtime.getURL("pages/assist/permission-assist.html"),
    );
    assistUrl.searchParams.set("url", url || "");
    if (pageUrl) {
      assistUrl.searchParams.set("pageUrl", pageUrl);
    }
    if (Array.isArray(missingOrigins) && missingOrigins.length > 0) {
      assistUrl.searchParams.set("origins", JSON.stringify(missingOrigins));
    }
    await chrome.tabs.create({ url: assistUrl.toString() });
  }

  async function ensureImportPermissions(url) {
    try {
      const missingOrigins = await findMissingOrigins(
        new Set([originPatternFromUrl(url)]),
      );
      if (missingOrigins.length === 0) {
        return true;
      }

      await safeLog("popup", "Import requires permission assist", {
        url,
        missingOrigins,
      });
      await openPermissionAssist(url, "", missingOrigins);
      statusController.setProgressState(null);
      stateStore.resetActiveImportSession();
      syncImportUiState();
      await clearStoredImportStatePreservingUi();
      return false;
    } catch (error) {
      statusController.setImportErrorState(
        error?.message || UI_MESSAGES.popup.importFailed,
      );
      stateStore.setActiveImportRequestId("");
      await clearStoredImportStatePreservingUi();
      await safeLog("popup", "Import permission precheck failed in popup", {
        url,
        error: error?.message || "unknown",
      });
      return false;
    }
  }

  async function runPopupImportRequest(url, requestId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.importUrl,
        url,
        requestId,
      });
      if (!response?.ok) {
        await safeLog("popup", "Popup import request was rejected", {
          url,
          error: response?.error || UI_MESSAGES.popup.importFailed,
          errorCode: String(response?.errorCode || ""),
        });
        const importError = new Error(
          response?.error || UI_MESSAGES.popup.importFailed,
        );
        importError.code = String(response?.errorCode || "");
        throw importError;
      }

      refs.importInput.value = "";
      const importedCount = Number(response.result?.importedCount) || 1;
      const convertedCount = Number(response.result?.convertedCount) || 0;
      const successMessage = buildImportSuccessMessage(
        url,
        importedCount,
        convertedCount,
      );
      statusController.setImportSuccessState(successMessage);
      stateStore.setActiveImportRequestId("");
      await clearStoredImportStatePreservingUi();
      await gridController.render();
    } catch (error) {
      if (
        String(error?.code || "") === IMPORT_ERROR_CODES.hostAccessRequired ||
        String(error?.message || "") === UI_MESSAGES.import.hostAccessRequired
      ) {
        await openPermissionAssist(url, "", []);
        statusController.setProgressState(null);
        stateStore.resetActiveImportSession();
        syncImportUiState();
        await clearStoredImportStatePreservingUi();
        return;
      }
      statusController.setImportErrorState(
        error?.message || UI_MESSAGES.popup.importFailed,
      );
      stateStore.setActiveImportRequestId("");
      await clearStoredImportStatePreservingUi();
      await safeLog("popup", "Import failed in popup", {
        url,
        requestId,
        errorCode: String(error?.code || ""),
        error: error?.message || "unknown",
      });
    }
  }

  async function terminateImport() {
    const requestId =
      state.activeImportRequestId || state.currentImportState?.requestId || "";
    if (!requestId) {
      statusController.showTransientStatus(
        UI_MESSAGES.popup.noActiveImportToTerminate,
        "error",
      );
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.terminateImport,
        requestId,
      });
      if (!response?.ok) {
        throw new Error(response?.error || UI_MESSAGES.popup.terminateFailed);
      }
      statusController.showTransientStatus(
        UI_MESSAGES.popup.importTerminationRequested,
        "ok",
      );
      await clearStoredImportStatePreservingUi();
    } catch (error) {
      statusController.showTransientStatus(
        error?.message || UI_MESSAGES.popup.terminateFailed,
        "error",
      );
    }
  }

  async function importUrl(rawUrl) {
    if (state.currentImportState?.active || state.activeImportRequestId) {
      statusController.showTransientStatus(
        UI_MESSAGES.popup.importAlreadyRunning,
        "error",
      );
      await safeLog("popup", "Import blocked while another import is active", {
        active: Boolean(state.currentImportState?.active),
        requestId:
          state.activeImportRequestId ||
          state.currentImportState?.requestId ||
          "",
      });
      syncImportUiState();
      return;
    }

    statusController.clearTransientStatus();
    const url = String(rawUrl || "").trim();
    if (!url) {
      statusController.setStatus(UI_MESSAGES.popup.pasteUrlFirst);
      return;
    }
    if (!isValidUrl(url)) {
      statusController.setImportErrorState(UI_MESSAGES.popup.enterValidUrl);
      return;
    }

    const requestId = crypto.randomUUID();
    stateStore.setActiveImportRequestId(requestId);
    stateStore.setImportState({
      requestId,
      text: UI_MESSAGES.popup.startingImport,
      kind: "info",
      active: true,
    });
    syncImportUiState();
    statusController.setStatus(UI_MESSAGES.popup.startingImport);
    statusController.setProgressState({
      text: UI_MESSAGES.popup.startingImport,
      kind: "info",
      active: true,
    });
    await safeLog("popup", "Import requested from popup", { url });

    const canContinueImport = await ensureImportPermissions(url);
    if (!canContinueImport) {
      return;
    }

    await runPopupImportRequest(url, requestId);
  }

  return {
    importUrl,
    terminateImport,
  };
}
