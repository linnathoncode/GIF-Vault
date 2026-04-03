import { idbDelete, idbSave } from "../lib/db.js";
import { extensionFromUrl } from "../lib/media.js";
import { STORAGE_KEYS, OFFSCREEN } from "../lib/settings.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import { UI_MESSAGES } from "../lib/messages.js";
import {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
} from "../lib/protocol.js";
import { originPatternFromUrl } from "../lib/ui.js";
import {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrls,
} from "./media-resolver.js";

const importAbortControllerById = new Map();
const terminatedImportIds = new Set();
let activeImportRequestId = "";
const SNIFF_BYTES_LENGTH = 16;

function isHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeHttpUrl(rawUrl, fallbackError = UI_MESSAGES.popup.enterValidUrl) {
  const value = String(rawUrl || "").trim();
  if (!isHttpUrl(value)) {
    throw createImportError(IMPORT_ERROR_CODES.invalidUrl, fallbackError);
  }
  return new URL(value).toString();
}

function buildLocalPseudoUrl(fileName = "") {
  const safeName = String(fileName || "").trim() || `local-${Date.now()}.bin`;
  return `https://local.file/${encodeURIComponent(safeName)}`;
}

function normalizeLocalFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file) => normalizeSingleLocalFile(file))
    .filter(Boolean);
}

function isBlobLike(value) {
  return (
    value instanceof Blob ||
    (
      Boolean(value) &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      typeof value.size === "number"
    )
  );
}

function normalizeSingleLocalFile(file) {
  if (isBlobLike(file)) {
    return {
      blob: file,
      name: String(file?.name || "").trim(),
      mimeType: String(file?.type || "").trim().toLowerCase(),
    };
  }

  if (
    !file ||
    typeof file !== "object" ||
    typeof file.bytesBase64 !== "string"
  ) {
    return null;
  }

  const bytes = base64ToUint8(file.bytesBase64);
  if (bytes.length === 0) {
    return null;
  }

  const mimeType = String(file.mimeType || "").trim().toLowerCase();
  const blob = new Blob([bytes], {
    type: mimeType || "application/octet-stream",
  });
  return {
    blob,
    name: String(file.name || "").trim(),
    mimeType,
  };
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

function isUserTerminatedImport(requestId, abortController, error) {
  if (
    getImportErrorCode(error) === IMPORT_ERROR_CODES.importTerminated ||
    error?.message === UI_MESSAGES.import.importTerminatedError
  ) {
    return true;
  }
  // AbortError should count as user termination only when this import was
  // explicitly marked as terminated by terminateImport().
  return (
    error?.name === "AbortError" &&
    Boolean(abortController?.signal?.aborted) &&
    terminatedImportIds.has(requestId)
  );
}

// Import orchestration.
async function importFromUrl(
  rawUrl,
  pageUrl,
  requestId = "",
  resolvedMediaUrlHint = "",
) {
  const progressId = requestId || crypto.randomUUID();
  const url = String(rawUrl || "").trim();
  if (!url) {
    await safeLog("import", "Rejected empty URL");
    throw createImportError(IMPORT_ERROR_CODES.invalidUrl, UI_MESSAGES.import.emptyUrl);
  }
  const normalizedUrl = normalizeHttpUrl(url);
  if (activeImportRequestId) {
    throw createImportError(
      IMPORT_ERROR_CODES.concurrentImportInProgress,
      UI_MESSAGES.import.concurrentImportInProgress,
    );
  }
  activeImportRequestId = progressId;

  const abortController = new AbortController();
  const ensureImportActive = () => throwIfTerminated(progressId, abortController);
  importAbortControllerById.set(progressId, abortController);
  let resolvedHints = [];
  const savedItems = [];
  try {
    resolvedHints = normalizeResolvedHints(resolvedMediaUrlHint);
    const runtimeConfig = await getRuntimeConfig();
    const gifConversionConfig = runtimeConfig.gifConversion;

    await reportProgress(
      progressId,
      UI_MESSAGES.import.resolvingMediaUrl,
      true,
      "info",
      UI_MESSAGES.import.phaseResolving,
    );

    ensureImportActive();
    await safeLog("import", "Import started", { url: normalizedUrl, pageUrl: pageUrl || "" });
    await ensureOriginAccess(normalizedUrl);

    const resolvedMediaUrls =
      resolvedHints.length > 0 ? resolvedHints : await resolveMediaUrls(normalizedUrl);
    ensureImportActive();
    if (!resolvedMediaUrls.length) {
      await safeLog("resolve", "Failed to resolve media URL", { url: normalizedUrl });
      throw new Error(UI_MESSAGES.import.couldNotResolveMediaUrl);
    }
    const safeResolvedMediaUrls = resolvedMediaUrls.map((candidate) =>
      normalizeHttpUrl(candidate),
    );
    await safeLog("resolve", "Resolved media URL", {
      url: normalizedUrl,
      resolvedMediaUrl: safeResolvedMediaUrls[0],
      resolvedMediaUrlCount: safeResolvedMediaUrls.length,
      reusedResolvedUrl: resolvedHints.length > 0,
    });
    for (let index = 0; index < safeResolvedMediaUrls.length; index += 1) {
      const resolvedMediaUrl = safeResolvedMediaUrls[index];
      ensureImportActive();
      await ensureOriginAccess(resolvedMediaUrl);
      const current = index + 1;
      const total = safeResolvedMediaUrls.length;
      const suffix = total > 1 ? ` (${current}/${total})` : "";
      await reportProgress(
        progressId,
        UI_MESSAGES.import.fetchingMedia(suffix),
        true,
        "info",
        UI_MESSAGES.import.phaseFetching,
      );
      const item = await importResolvedMedia({
        sourceUrl: normalizedUrl,
        resolvedMediaUrl,
        pageUrl,
        progressId,
        abortController,
        gifConversionConfig,
        ensureImportActive,
      });
      ensureImportActive();
      savedItems.push(item);
      await notifyVaultUpdated(item.id);
    }

    await reportProgress(
      progressId,
      savedItems.length > 1
        ? UI_MESSAGES.import.importedMany(savedItems.length)
        : UI_MESSAGES.import.importedSingle,
      false,
      "success",
      UI_MESSAGES.import.phaseComplete,
    );
    return {
      id: savedItems[0]?.id || "",
      kind: savedItems[0]?.kind || "image",
      converted: savedItems.some((item) => item.converted),
      importedCount: savedItems.length,
      convertedCount: savedItems.filter((item) => item.converted).length,
    };
  } catch (error) {
    const isTerminatedError = isUserTerminatedImport(
      progressId,
      abortController,
      error,
    );
    const message = isTerminatedError
      ? UI_MESSAGES.import.importTerminated
      : error?.message || UI_MESSAGES.import.importFailed;
    if (savedItems.length > 0 && !isTerminatedError) {
      await rollbackSavedItems(savedItems);
    }
    if (message === UI_MESSAGES.import.hostAccessRequired) {
      // Permission-assist flow owns this feedback; keep popup progress clear.
      await reportProgress(
        progressId,
        "",
        false,
        "info",
        UI_MESSAGES.import.phaseIdle,
      );
    } else {
      await reportProgress(
        progressId,
        message,
        false,
        "error",
        UI_MESSAGES.import.phaseComplete,
      );
    }
    throw createImportError(getImportErrorCode(error), message);
  } finally {
    importAbortControllerById.delete(progressId);
    terminatedImportIds.delete(progressId);
    if (activeImportRequestId === progressId) {
      activeImportRequestId = "";
    }
  }
}

async function importFromFiles(files, requestId = "") {
  const progressId = requestId || crypto.randomUUID();
  const localFiles = normalizeLocalFiles(files);
  if (!localFiles.length) {
    await safeLog("import", "Rejected empty local file selection");
    throw createImportError(IMPORT_ERROR_CODES.invalidUrl, UI_MESSAGES.popup.chooseFilesFirst);
  }
  if (activeImportRequestId) {
    throw createImportError(
      IMPORT_ERROR_CODES.concurrentImportInProgress,
      UI_MESSAGES.import.concurrentImportInProgress,
    );
  }
  activeImportRequestId = progressId;

  const abortController = new AbortController();
  const ensureImportActive = () => throwIfTerminated(progressId, abortController);
  importAbortControllerById.set(progressId, abortController);
  const savedItems = [];
  try {
    const runtimeConfig = await getRuntimeConfig();
    const gifConversionConfig = runtimeConfig.gifConversion;

    await reportProgress(
      progressId,
      UI_MESSAGES.import.readingLocalFiles(),
      true,
      "info",
      UI_MESSAGES.import.phaseFetching,
    );
    await safeLog("import", "Local file import started", {
      fileCount: localFiles.length,
    });

    for (let index = 0; index < localFiles.length; index += 1) {
      ensureImportActive();
      const current = index + 1;
      const total = localFiles.length;
      const suffix = total > 1 ? ` (${current}/${total})` : "";
      await reportProgress(
        progressId,
        UI_MESSAGES.import.readingLocalFiles(suffix),
        true,
        "info",
        UI_MESSAGES.import.phaseFetching,
      );

      const item = await importLocalFileMedia({
        localFile: localFiles[index],
        progressId,
        gifConversionConfig,
        ensureImportActive,
      });
      ensureImportActive();
      savedItems.push(item);
      await notifyVaultUpdated(item.id);
    }

    await reportProgress(
      progressId,
      savedItems.length > 1
        ? UI_MESSAGES.import.importedMany(savedItems.length)
        : UI_MESSAGES.import.importedSingle,
      false,
      "success",
      UI_MESSAGES.import.phaseComplete,
    );
    return {
      id: savedItems[0]?.id || "",
      kind: savedItems[0]?.kind || "image",
      converted: savedItems.some((item) => item.converted),
      importedCount: savedItems.length,
      convertedCount: savedItems.filter((item) => item.converted).length,
    };
  } catch (error) {
    const isTerminatedError = isUserTerminatedImport(
      progressId,
      abortController,
      error,
    );
    const message = isTerminatedError
      ? UI_MESSAGES.import.importTerminated
      : error?.message || UI_MESSAGES.import.importFailed;
    if (savedItems.length > 0 && !isTerminatedError) {
      await rollbackSavedItems(savedItems);
    }
    await reportProgress(
      progressId,
      message,
      false,
      "error",
      UI_MESSAGES.import.phaseComplete,
    );
    throw createImportError(getImportErrorCode(error), message);
  } finally {
    importAbortControllerById.delete(progressId);
    terminatedImportIds.delete(progressId);
    if (activeImportRequestId === progressId) {
      activeImportRequestId = "";
    }
  }
}

function normalizeResolvedHints(resolvedMediaUrlHint) {
  if (Array.isArray(resolvedMediaUrlHint)) {
    return [...new Set(resolvedMediaUrlHint.map((url) => normalizeHttpUrl(url)).filter(Boolean))];
  }

  const single = String(resolvedMediaUrlHint || "").trim();
  return single ? [normalizeHttpUrl(single)] : [];
}

async function importResolvedMedia({
  sourceUrl,
  resolvedMediaUrl,
  pageUrl,
  progressId,
  abortController,
  gifConversionConfig,
  ensureImportActive,
}) {
  ensureImportActive();
  const response = await fetch(resolvedMediaUrl, {
    signal: abortController.signal,
  });
  ensureImportActive();
  if (!response.ok) {
    await safeLog("fetch", "Fetch failed", {
      resolvedMediaUrl,
      status: response.status,
    });
    throw new Error(UI_MESSAGES.import.failedToFetchMedia);
  }
  await safeLog("fetch", "Fetch succeeded", {
    resolvedMediaUrl,
    status: response.status,
  });

  const finalResponseUrl = normalizeHttpUrl(response.url || resolvedMediaUrl);
  await ensureOriginAccess(finalResponseUrl);

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const isBinaryFallback =
    !contentType || contentType.includes("octet-stream");
  if (
    !isBinaryFallback &&
    !isSupportedMediaType(contentType, { url: finalResponseUrl })
  ) {
    await safeLog("fetch", "Rejected non-media response", {
      resolvedMediaUrl: finalResponseUrl,
      contentType,
    });
    throw new Error(getReadableImportError(sourceUrl, contentType));
  }

  const inputBlob = await readBlobWithMaxSize(
    response,
    resolveMaxDownloadBytes(gifConversionConfig),
    ensureImportActive,
  );
  ensureImportActive();
  const sniffBytes = await readBlobSniffBytes(inputBlob);
  if (!isSupportedMediaType(contentType, { url: finalResponseUrl, sniffBytes })) {
    await safeLog("fetch", "Rejected non-media response after binary fallback checks", {
      resolvedMediaUrl: finalResponseUrl,
      contentType,
    });
    throw new Error(getReadableImportError(sourceUrl, contentType));
  }

  const ext = extensionFromUrl(finalResponseUrl, inputBlob.type);
  const isVideoMedia =
    (inputBlob.type || "").startsWith("video/") ||
    ext === "mp4" ||
    ext === "webm";

  let finalBlob = inputBlob;
  let finalMime = inputBlob.type || "image/gif";
  let converted = false;

  if (isVideoMedia) {
    await reportProgress(
      progressId,
      UI_MESSAGES.import.checkingMediaSize,
      true,
      "info",
      UI_MESSAGES.import.phaseChecking,
    );
    await safeLog("convert", "Video detected, offscreen conversion requested", {
      resolvedMediaUrl,
      sourceUrl,
      extension: ext,
      mimeType: inputBlob.type || "",
      isTwitterSource: isTwitterUrl(sourceUrl),
    });
    try {
      const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
      ensureImportActive();
      await reportProgress(
        progressId,
        UI_MESSAGES.import.convertingVideoToGif,
        true,
        "info",
        UI_MESSAGES.import.phaseConverting,
      );
      const convertedPayload = await convertInOffscreen({
        url: resolvedMediaUrl,
        requestId: progressId,
        filename: `vault-${Date.now()}.gif`,
        inputExtension: ext,
        gifConversion: gifConversionConfig,
        inputBytes,
      });
      ensureImportActive();
      const rebuiltBlob = blobFromConvertedPayload(convertedPayload);
      await safeLog("convert", "Offscreen conversion response received", {
        converted: Boolean(convertedPayload?.converted),
        mimeType: convertedPayload?.mimeType || "",
        reason: convertedPayload?.reason || "",
        hasGifBase64: Boolean(convertedPayload?.gifBase64),
        gifBase64Length: convertedPayload?.gifBase64
          ? convertedPayload.gifBase64.length
          : 0,
        gifByteLength: convertedPayload?.gifByteLength || 0,
        hasGifBuffer: Boolean(convertedPayload?.gifBuffer),
        rebuiltBlobSize: rebuiltBlob?.size || 0,
      });

      if (rebuiltBlob && rebuiltBlob.size > 0) {
        finalBlob = rebuiltBlob;
        finalMime = convertedPayload.mimeType || "image/gif";
        converted = Boolean(convertedPayload.converted);
      } else {
        await safeLog("convert", "Offscreen payload had no usable blob", {
          mimeType: convertedPayload?.mimeType || "",
          reason: convertedPayload?.reason || "",
          extension: ext,
        });
        throw new Error(UI_MESSAGES.import.offscreenConversionFailed);
      }
    } catch (error) {
      await safeLog("convert", "Offscreen conversion failed", {
        error: error?.message || "unknown",
        extension: ext,
      });
      throw new Error(error?.message || UI_MESSAGES.import.offscreenConversionFailed);
    }
  }

  await reportProgress(
    progressId,
    UI_MESSAGES.import.savingToVault,
    true,
    "info",
    UI_MESSAGES.import.phaseSaving,
  );
  ensureImportActive();
  const item = {
    id: crypto.randomUUID(),
    name: inferName(sourceUrl, resolvedMediaUrl),
    sourceUrl,
    mediaUrl: finalResponseUrl,
    pageUrl: pageUrl || "",
    mimeType: finalMime,
    kind: finalMime.startsWith("video/") ? "video" : "image",
    blob: finalBlob,
    converted,
    savedAt: Date.now(),
  };

  await idbSave(item);
  ensureImportActive();
  await safeLog("save", "Media saved to IndexedDB", {
    id: item.id,
    kind: item.kind,
    mimeType: item.mimeType,
    blobSize: item.blob?.size || 0,
    converted: item.converted,
  });
  return item;
}

async function importLocalFileMedia({
  localFile,
  progressId,
  gifConversionConfig,
  ensureImportActive,
}) {
  ensureImportActive();
  const inputBlob = localFile.blob;
  const maxBytes = resolveMaxDownloadBytes(gifConversionConfig);
  if (inputBlob.size > maxBytes) {
    throw new Error(mediaTooLargeMessage(maxBytes));
  }

  const pseudoUrl = buildLocalPseudoUrl(localFile.name);
  const sniffBytes = await readBlobSniffBytes(inputBlob);
  const contentType = localFile.mimeType || inputBlob.type || "";
  if (!isSupportedMediaType(contentType, { url: pseudoUrl, sniffBytes })) {
    await safeLog("import", "Rejected unsupported local file", {
      fileName: localFile.name || "",
      mimeType: contentType,
      size: inputBlob.size,
    });
    throw new Error(UI_MESSAGES.import.localFileNotMedia);
  }

  const ext = extensionFromUrl(pseudoUrl, inputBlob.type || contentType);
  const isVideoMedia =
    (contentType || "").startsWith("video/") ||
    ext === "mp4" ||
    ext === "webm";

  let finalBlob = inputBlob;
  let finalMime = inputBlob.type || contentType || "image/gif";
  let converted = false;

  if (isVideoMedia) {
    await reportProgress(
      progressId,
      UI_MESSAGES.import.checkingMediaSize,
      true,
      "info",
      UI_MESSAGES.import.phaseChecking,
    );
    await safeLog("convert", "Local video detected, offscreen conversion requested", {
      fileName: localFile.name || "",
      extension: ext,
      mimeType: contentType || "",
      size: inputBlob.size,
    });
    try {
      const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
      ensureImportActive();
      await reportProgress(
        progressId,
        UI_MESSAGES.import.convertingVideoToGif,
        true,
        "info",
        UI_MESSAGES.import.phaseConverting,
      );
      const convertedPayload = await convertInOffscreen({
        url: pseudoUrl,
        requestId: progressId,
        filename: `vault-${Date.now()}.gif`,
        inputExtension: ext,
        gifConversion: gifConversionConfig,
        inputBytes,
      });
      ensureImportActive();
      const rebuiltBlob = blobFromConvertedPayload(convertedPayload);
      if (rebuiltBlob && rebuiltBlob.size > 0) {
        finalBlob = rebuiltBlob;
        finalMime = convertedPayload.mimeType || "image/gif";
        converted = Boolean(convertedPayload.converted);
      } else {
        throw new Error(UI_MESSAGES.import.offscreenConversionFailed);
      }
    } catch (error) {
      await safeLog("convert", "Local offscreen conversion failed", {
        error: error?.message || "unknown",
        extension: ext,
      });
      throw new Error(error?.message || UI_MESSAGES.import.offscreenConversionFailed);
    }
  }

  await reportProgress(
    progressId,
    UI_MESSAGES.import.savingToVault,
    true,
    "info",
    UI_MESSAGES.import.phaseSaving,
  );
  ensureImportActive();
  const item = {
    id: crypto.randomUUID(),
    name: inferNameFromLocalFile(localFile.name),
    sourceUrl: "",
    mediaUrl: "",
    pageUrl: "",
    mimeType: finalMime,
    kind: finalMime.startsWith("video/") ? "video" : "image",
    blob: finalBlob,
    converted,
    savedAt: Date.now(),
  };

  await idbSave(item);
  ensureImportActive();
  await safeLog("save", "Local media saved to IndexedDB", {
    id: item.id,
    kind: item.kind,
    mimeType: item.mimeType,
    blobSize: item.blob?.size || 0,
    converted: item.converted,
  });
  return item;
}

async function readBlobSniffBytes(blob) {
  try {
    const bytes = new Uint8Array(
      await blob.slice(0, SNIFF_BYTES_LENGTH).arrayBuffer(),
    );
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

async function readBlobWithMaxSize(response, maxBytes, ensureImportActive) {
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      while (true) {
        ensureImportActive();
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new Error(mediaTooLargeMessage(maxBytes));
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // no-op
      }
    }

    const mimeType = response.headers.get("content-type") || "application/octet-stream";
    return new Blob(chunks, { type: mimeType });
  }

  const blob = await response.blob();
  ensureImportActive();
  if (blob.size > maxBytes) {
    throw new Error(mediaTooLargeMessage(maxBytes));
  }
  return blob;
}

async function terminateImport(requestId) {
  const id = String(requestId || "").trim();
  if (!id) {
    throw createImportError(IMPORT_ERROR_CODES.invalidUrl, UI_MESSAGES.import.missingRequestId);
  }

  terminatedImportIds.add(id);
  const controller = importAbortControllerById.get(id);
  if (controller) {
    controller.abort();
  }

  await safeLog("import", "Terminate import requested", { requestId: id });
  await reportProgress(
    id,
    UI_MESSAGES.import.importTerminated,
    false,
    "error",
    UI_MESSAGES.import.phaseComplete,
  );
  return Boolean(controller);
}

function throwIfTerminated(requestId, abortController = null) {
  if (
    terminatedImportIds.has(requestId) ||
    Boolean(abortController?.signal?.aborted)
  ) {
    throw createImportError(
      IMPORT_ERROR_CODES.importTerminated,
      UI_MESSAGES.import.importTerminatedError,
    );
  }
}

async function rollbackSavedItems(savedItems) {
  const items = [...savedItems].filter((item) => item?.id);
  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    try {
      await idbDelete(item.id);
      await notifyVaultUpdated(item.id);
    } catch (error) {
      await safeLog("save", "Rollback delete failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  await safeLog("save", "Rolled back partially saved batch import", {
    rolledBackCount: items.length,
  });
}

// Offscreen conversion helpers.
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN.url,
    reasons: ["BLOBS"],
    justification: "Convert imported MP4 media into GIF in background",
  });
}

async function convertInOffscreen({
  url,
  requestId = "",
  filename,
  inputExtension = "",
  gifConversion = null,
  inputBytes = null,
}) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONVERT_MP4",
    url,
    requestId,
    filename,
    inputExtension,
    gifConversion,
    inputBytes,
  });
  if (!response?.ok) {
    await safeLog("convert", "Offscreen conversion failed", {
      error: response?.error || "unknown",
    });
    throw new Error(response?.error || UI_MESSAGES.import.offscreenConversionFailed);
  }

  return response.payload;
}

function blobFromConvertedPayload(payload) {
  if (!payload) {
    return null;
  }
  if (payload.blob instanceof Blob) {
    return payload.blob;
  }

  const mimeType = payload.mimeType || "image/gif";
  if (typeof payload.gifBase64 === "string" && payload.gifBase64.length > 0) {
    const bytes = base64ToUint8(payload.gifBase64);
    if (bytes.length > 0) {
      return new Blob([bytes], { type: mimeType });
    }
  }
  if (payload.gifBuffer instanceof ArrayBuffer) {
    return new Blob([payload.gifBuffer], { type: mimeType });
  }
  if (ArrayBuffer.isView(payload.gifBuffer)) {
    return new Blob([payload.gifBuffer.buffer], { type: mimeType });
  }
  return null;
}

function base64ToUint8(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

// Permission checks and runtime updates.
async function ensureOriginAccess(rawUrl) {
  const originPattern = originPatternFromUrl(rawUrl);
  if (!originPattern) {
    return;
  }

  const hasAccess = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (hasAccess) {
    return;
  }

  await safeLog("permissions", "Missing host access for origin", {
    origin: originPattern,
  });
  throw createImportError(
    IMPORT_ERROR_CODES.hostAccessRequired,
    UI_MESSAGES.import.hostAccessRequired,
  );
}

async function reportProgress(
  requestId,
  text,
  active = true,
  kind = "info",
  phase = "",
) {
  try {
    const normalizedPhase = String(phase || "").trim();
    await chrome.storage.local.set({
      [STORAGE_KEYS.importState]: {
        requestId,
        text,
        kind,
        phase: normalizedPhase,
        active: Boolean(active),
        updatedAt: Date.now(),
      },
    });
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.importProgress,
      requestId,
      text,
      kind,
      phase: normalizedPhase,
      active: Boolean(active),
    });
  } catch {
    // Popup may be closed; ignore progress delivery failures.
  }
}

async function notifyVaultUpdated(itemId) {
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.vaultUpdated,
      itemId,
    });
  } catch {
    // Popup may be closed; ignore.
  }
}

function inferName(sourceUrl, mediaUrl) {
  const candidate = mediaUrl || sourceUrl || "";
  try {
    const url = new URL(candidate);
    const file = url.pathname.split("/").filter(Boolean).pop() || "";
    const noExt = file.replace(/\.[a-z0-9]+$/i, "").trim();
    if (noExt) {
      return noExt.slice(0, 40);
    }
    return `gif-${Date.now()}`;
  } catch {
    return `gif-${Date.now()}`;
  }
}

function inferNameFromLocalFile(fileName) {
  const trimmed = String(fileName || "").trim();
  if (!trimmed) {
    return `gif-${Date.now()}`;
  }

  const baseName = trimmed.replace(/\.[a-z0-9]+$/i, "").trim();
  return (baseName || trimmed).slice(0, 40);
}

export { importFromFiles, importFromUrl, terminateImport };
