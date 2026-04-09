import { safeLog } from "../../../lib/log.js";
import { UI_MESSAGES } from "../../../lib/messages.js";
import { getRuntimeConfig, normalizeRuntimeConfig } from "../../../lib/runtime-config.js";
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

function buildLocalImportSuccessMessage(importedCount, convertedCount) {
  const parts = [];

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

function uint8ToBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return "";
  }
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getLocalPathHint(file) {
  const directPath = String(file?.path || "").trim();
  if (directPath) {
    return directPath;
  }
  const relativePath = String(file?.webkitRelativePath || "").trim();
  if (relativePath) {
    return relativePath;
  }
  return "";
}

function resolveMaxDownloadBytes(gifConversionConfig) {
  const mb = Number(gifConversionConfig?.maxDownloadSizeMb);
  if (!Number.isFinite(mb) || mb <= 0) {
    return 50 * 1024 * 1024;
  }
  return Math.round(mb * 1024 * 1024);
}

function mediaTooLargeMessage(maxBytes) {
  const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
  return UI_MESSAGES.import.mediaTooLarge(maxMb);
}

async function serializeLocalFilesForMessage(files) {
  const payloads = [];
  for (const file of files) {
    if (!(file instanceof Blob)) {
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    payloads.push({
      name: String(file?.name || ""),
      mimeType: String(file?.type || ""),
      byteLength: Number(file?.size || 0),
      localPath: getLocalPathHint(file),
      bytesBase64: uint8ToBase64(bytes),
    });
  }
  return payloads;
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

/**
 * Creates the popup-scoped import controller that coordinates UI state,
 * runtime messages, permission-assist handoff, and post-import grid refresh.
 *
 * The returned handlers are intended to be wired by the popup page coordinator.
 */
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

  async function runPopupImportFilesRequest(files, requestId, sourceUrlHint = "") {
    try {
      let response = null;
      try {
        // Prefer sending native File/Blob objects to avoid expensive popup-side
        // base64 serialization that can stall hover/interaction responsiveness.
        response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.importFiles,
          files,
          requestId,
          sourceUrlHint: String(sourceUrlHint || ""),
        });
      } catch {
        const serializedFiles = await serializeLocalFilesForMessage(files);
        if (serializedFiles.length === 0) {
          throw new Error(UI_MESSAGES.popup.chooseFilesFirst);
        }
        response = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.importFiles,
          files: serializedFiles,
          requestId,
          sourceUrlHint: String(sourceUrlHint || ""),
        });
      }
      if (!response?.ok) {
        await safeLog("popup", "Popup local file import request was rejected", {
          fileCount: files.length,
          error: response?.error || UI_MESSAGES.popup.importFailed,
          errorCode: String(response?.errorCode || ""),
        });
        const importError = new Error(
          response?.error || UI_MESSAGES.popup.importFailed,
        );
        importError.code = String(response?.errorCode || "");
        throw importError;
      }

      if (refs.localFileInput) {
        refs.localFileInput.value = "";
      }
      const importedCount = Number(response.result?.importedCount) || 1;
      const convertedCount = Number(response.result?.convertedCount) || 0;
      const successMessage = buildLocalImportSuccessMessage(
        importedCount,
        convertedCount,
      );
      const hasTerminalProgressFeedback =
        Boolean(state.currentImportState?.text) &&
        !Boolean(state.currentImportState?.active) &&
        (state.currentImportState?.kind === "success" ||
          state.currentImportState?.kind === "error");
      if (!hasTerminalProgressFeedback) {
        statusController.setImportSuccessState(successMessage);
      }
      stateStore.setActiveImportRequestId("");
      await clearStoredImportStatePreservingUi();
      await gridController.render();
    } catch (error) {
      const hasTerminalProgressFeedback =
        Boolean(state.currentImportState?.text) &&
        !Boolean(state.currentImportState?.active) &&
        (state.currentImportState?.kind === "success" ||
          state.currentImportState?.kind === "error");
      if (!hasTerminalProgressFeedback) {
        statusController.setImportErrorState(
          error?.message || UI_MESSAGES.popup.importFailed,
        );
      }
      stateStore.setActiveImportRequestId("");
      await clearStoredImportStatePreservingUi();
      await safeLog("popup", "Local file import failed in popup", {
        requestId,
        fileCount: files.length,
        errorCode: String(error?.code || ""),
        error: error?.message || "unknown",
      });
    }
  }

  function openLocalFilePicker() {
    refs.localFileInput?.click();
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
      stateStore.setImportTerminationPending(requestId);
      statusController.applyImportState({
        requestId,
        text: UI_MESSAGES.popup.importTerminationRequested,
        kind: "info",
        phase: UI_MESSAGES.import.phaseComplete,
        active: true,
      });
      syncImportUiState();
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.terminateImport,
        requestId,
      });
      if (!response?.ok) {
        throw new Error(response?.error || UI_MESSAGES.popup.terminateFailed);
      }
      // Keep popup termination-pending state alive until the import pipeline
      // emits its real terminal progress update.
    } catch (error) {
      stateStore.clearImportTerminationPending();
      syncImportUiState();
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

  async function importFiles(rawFiles, options = {}) {
    if (state.currentImportState?.active || state.activeImportRequestId) {
      statusController.showTransientStatus(
        UI_MESSAGES.popup.importAlreadyRunning,
        "error",
      );
      await safeLog("popup", "Local file import blocked while another import is active", {
        active: Boolean(state.currentImportState?.active),
        requestId:
          state.activeImportRequestId ||
          state.currentImportState?.requestId ||
          "",
      });
      syncImportUiState();
      return;
    }

    const files = Array.isArray(rawFiles)
      ? rawFiles.filter((file) => file instanceof Blob)
      : [];
    if (files.length === 0) {
      statusController.showTransientStatus(
        UI_MESSAGES.popup.chooseFilesFirst,
        "error",
      );
      if (refs.localFileInput) {
        refs.localFileInput.value = "";
      }
      return;
    }

    const runtimeConfig = await getRuntimeConfig()
      .then((value) => normalizeRuntimeConfig(value || {}))
      .catch(() => normalizeRuntimeConfig({}));
    const maxBytes = resolveMaxDownloadBytes(runtimeConfig.gifConversion);
    const tooLargeFile = files.find((file) => Number(file?.size || 0) > maxBytes);
    if (tooLargeFile) {
      statusController.showTransientStatus(mediaTooLargeMessage(maxBytes), "error");
      await safeLog("popup", "Local file import blocked by preflight size check", {
        fileName: String(tooLargeFile?.name || ""),
        size: Number(tooLargeFile?.size || 0),
        maxBytes,
      });
      if (refs.localFileInput) {
        refs.localFileInput.value = "";
      }
      return;
    }

    statusController.clearTransientStatus();
    const requestId = crypto.randomUUID();
    stateStore.setActiveImportRequestId(requestId);
    stateStore.setImportState({
      requestId,
      text: UI_MESSAGES.popup.startingFileImport,
      kind: "info",
      active: true,
    });
    syncImportUiState();
    statusController.setProgressState({
      text: UI_MESSAGES.popup.startingFileImport,
      kind: "info",
      active: true,
    });
    await safeLog("popup", "Local file import requested from popup", {
      fileCount: files.length,
      sourceUrlHint: String(options?.sourceUrlHint || ""),
    });

    await runPopupImportFilesRequest(
      files,
      requestId,
      String(options?.sourceUrlHint || ""),
    );
  }

  return {
    openLocalFilePicker,
    importFiles,
    importUrl,
    terminateImport,
  };
}
