import { idbSave } from "../lib/db.js";
import { extensionFromUrl } from "../lib/media.js";
import { STORAGE_KEYS, OFFSCREEN } from "../lib/settings.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import { originPatternFromUrl } from "../lib/ui.js";
import {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
} from "./media-resolver.js";

const importAbortControllerById = new Map();
const terminatedImportIds = new Set();

// Import orchestration.
async function importFromUrl(
  rawUrl,
  pageUrl,
  requestId = "",
  resolvedMediaUrlHint = "",
) {
  const progressId = requestId || crypto.randomUUID();
  const abortController = new AbortController();
  const ensureImportActive = () => throwIfTerminated(progressId, abortController);
  importAbortControllerById.set(progressId, abortController);

  const runtimeConfig = await getRuntimeConfig();
  const gifConversionConfig = runtimeConfig.gifConversion;
  const url = String(rawUrl || "").trim();
  const resolvedHint = String(resolvedMediaUrlHint || "").trim();
  if (!url) {
    await safeLog("import", "Rejected empty URL");
    throw new Error("Empty URL");
  }

  await reportProgress(progressId, "Resolving media URL...", true, "info");
  try {
    ensureImportActive();
    await safeLog("import", "Import started", { url, pageUrl: pageUrl || "" });
    await ensureOriginAccess(url);

    const resolvedMediaUrl = resolvedHint || (await resolveMediaUrl(url));
    ensureImportActive();
    if (!resolvedMediaUrl) {
      await safeLog("resolve", "Failed to resolve media URL", { url });
      throw new Error("Could not resolve media URL");
    }
    await safeLog("resolve", "Resolved media URL", {
      url,
      resolvedMediaUrl,
      reusedResolvedUrl: Boolean(resolvedHint),
    });
    await ensureOriginAccess(resolvedMediaUrl);

    await reportProgress(progressId, "Fetching media...", true, "info");
    const response = await fetch(resolvedMediaUrl, {
      signal: abortController.signal,
    });
    ensureImportActive();
    if (!response.ok) {
      await safeLog("fetch", "Fetch failed", {
        resolvedMediaUrl,
        status: response.status,
      });
      throw new Error("Failed to fetch media");
    }
    await safeLog("fetch", "Fetch succeeded", {
      resolvedMediaUrl,
      status: response.status,
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!isSupportedMediaType(contentType)) {
      await safeLog("fetch", "Rejected non-media response", {
        resolvedMediaUrl,
        contentType,
      });
      throw new Error(getReadableImportError(url, contentType));
    }

    const inputBlob = await response.blob();
    ensureImportActive();
    const ext = extensionFromUrl(resolvedMediaUrl, inputBlob.type);
    const isVideoMedia =
      (inputBlob.type || "").startsWith("video/") ||
      ext === "mp4" ||
      ext === "webm";

    let finalBlob = inputBlob;
    let finalMime = inputBlob.type || "image/gif";
    let converted = false;

    if (isVideoMedia) {
      await reportProgress(progressId, "Checking video length...", true, "info");
      await safeLog("convert", "Video detected, offscreen conversion requested", {
        resolvedMediaUrl,
        sourceUrl: url,
        extension: ext,
        mimeType: inputBlob.type || "",
        isTwitterSource: isTwitterUrl(url),
      });
      try {
        const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
        ensureImportActive();
        const durationSeconds = await probeDurationInOffscreen({
          url: resolvedMediaUrl,
          inputExtension: ext,
          inputBytes,
        });
        ensureImportActive();
        if (durationSeconds > gifConversionConfig.maxDurationSeconds) {
          await safeLog("convert", "Rejected long video in background", {
            durationSeconds,
            maxDurationSeconds: gifConversionConfig.maxDurationSeconds,
          });
          throw new Error(
            `Video too long (${gifConversionConfig.maxDurationSeconds}s/${durationSeconds.toFixed(1)}s). Change length limit in Options.`,
          );
        }

        await reportProgress(progressId, "Converting video to GIF...", true, "info");
        const convertedPayload = await convertInOffscreen(
          {
            url: resolvedMediaUrl,
            requestId: progressId,
            filename: `vault-${Date.now()}.gif`,
            inputExtension: ext,
            gifConversion: gifConversionConfig,
            inputBytes,
          },
        );
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
          throw new Error("Could not convert video to GIF.");
        }
      } catch (error) {
        await safeLog("convert", "Offscreen conversion failed", {
          error: error?.message || "unknown",
          extension: ext,
        });
        throw new Error(error?.message || "Could not convert video to GIF.");
      }
    }

    ensureImportActive();
    await reportProgress(progressId, "Saving to vault...", true, "info");
    const item = {
      id: crypto.randomUUID(),
      name: inferName(url, resolvedMediaUrl),
      sourceUrl: url,
      mediaUrl: resolvedMediaUrl,
      pageUrl: pageUrl || "",
      mimeType: finalMime,
      kind: finalMime.startsWith("video/") ? "video" : "image",
      blob: finalBlob,
      converted,
      savedAt: Date.now(),
    };

    await idbSave(item);
    await safeLog("save", "Media saved to IndexedDB", {
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      blobSize: item.blob?.size || 0,
      converted: item.converted,
    });
    await notifyVaultUpdated(item.id);
    await reportProgress(progressId, "Imported successfully.", false, "success");
    return { id: item.id, kind: item.kind, converted };
  } catch (error) {
    const message =
      error?.name === "AbortError" || error?.message === "IMPORT_TERMINATED"
        ? "Import terminated by user."
        : error?.message || "Import failed";
    await reportProgress(progressId, message, false, "error");
    throw new Error(message);
  } finally {
    importAbortControllerById.delete(progressId);
    terminatedImportIds.delete(progressId);
  }
}

async function terminateImport(requestId) {
  const id = String(requestId || "").trim();
  if (!id) {
    throw new Error("Missing requestId");
  }

  terminatedImportIds.add(id);
  const controller = importAbortControllerById.get(id);
  if (controller) {
    controller.abort();
  }

  await safeLog("import", "Terminate import requested", { requestId: id });
  await reportProgress(id, "Import terminated by user.", false, "error");
  return Boolean(controller);
}

function throwIfTerminated(requestId, abortController = null) {
  if (
    terminatedImportIds.has(requestId) ||
    Boolean(abortController?.signal?.aborted)
  ) {
    throw new Error("IMPORT_TERMINATED");
  }
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
    throw new Error(response?.error || "Offscreen conversion failed");
  }

  return response.payload;
}

async function probeDurationInOffscreen({
  url,
  inputExtension = "",
  inputBytes = null,
}) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PROBE_VIDEO_DURATION",
    url,
    inputExtension,
    inputBytes,
  });
  if (!response?.ok) {
    await safeLog("convert", "Offscreen probe failed", {
      error: response?.error || "unknown",
    });
    throw new Error(response?.error || "Could not check video length.");
  }

  const durationSeconds = Number(response?.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error("Could not determine video duration.");
  }
  return durationSeconds;
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
  throw new Error(
    `Host access needed for ${originPattern}. Use popup import to grant access.`,
  );
}

async function reportProgress(requestId, text, active = true, kind = "info") {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.importState]: {
        requestId,
        text,
        kind,
        active: Boolean(active),
        updatedAt: Date.now(),
      },
    });
    await chrome.runtime.sendMessage({
      type: "IMPORT_PROGRESS",
      requestId,
      text,
      kind,
      active: Boolean(active),
    });
  } catch {
    // Popup may be closed; ignore progress delivery failures.
  }
}

async function notifyVaultUpdated(itemId) {
  try {
    await chrome.runtime.sendMessage({
      type: "VAULT_UPDATED",
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

export { importFromUrl, terminateImport };
