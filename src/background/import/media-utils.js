/**
 * Shared import/media utility helpers.
 * Provides URL normalization, local-file payload normalization, blob size/sniff
 * helpers, converted payload rebuilding, and import item naming utilities.
 */
import { UI_MESSAGES } from "../../lib/messages.js";
import { IMPORT_ERROR_CODES, createImportError } from "../../lib/protocol.js";

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

function normalizeOptionalHttpUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  try {
    return normalizeHttpUrl(value);
  } catch {
    return "";
  }
}

function buildLocalPseudoUrl(fileName = "") {
  const safeName = String(fileName || "").trim() || `local-${Date.now()}.bin`;
  return `https://local.file/${encodeURIComponent(safeName)}`;
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

function normalizeSingleLocalFile(file) {
  if (isBlobLike(file)) {
    return {
      blob: file,
      name: String(file?.name || "").trim(),
      mimeType: String(file?.type || "").trim().toLowerCase(),
      localPath: String(file?.path || file?.webkitRelativePath || "").trim(),
    };
  }

  if (
    !file ||
    typeof file !== "object" ||
    typeof file.bytesBase64 !== "string"
  ) {
    return null;
  }

  const bytesBase64 = String(file.bytesBase64 || "");
  if (!bytesBase64) {
    return null;
  }
  const mimeType = String(file.mimeType || "").trim().toLowerCase();
  return {
    bytesBase64,
    byteLength: Number(file.byteLength || estimateBase64ByteLength(bytesBase64) || 0),
    name: String(file.name || "").trim(),
    mimeType,
    localPath: String(file.localPath || file.path || file.webkitRelativePath || "").trim(),
  };
}

function normalizeLocalFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file) => normalizeSingleLocalFile(file))
    .filter(Boolean);
}

function estimateBase64ByteLength(base64) {
  const value = String(base64 || "").trim();
  if (!value) {
    return 0;
  }
  const normalized = value.replace(/\s+/g, "");
  const paddingMatch = normalized.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function getLocalFileByteLength(localFile) {
  if (localFile?.blob instanceof Blob) {
    return localFile.blob.size;
  }
  const declaredLength = Number(localFile?.byteLength);
  if (Number.isFinite(declaredLength) && declaredLength >= 0) {
    return declaredLength;
  }
  return estimateBase64ByteLength(localFile?.bytesBase64 || "");
}

function materializeLocalFileBlob(localFile, maxBytes) {
  if (localFile?.blob instanceof Blob) {
    if (localFile.blob.size > maxBytes) {
      throw new Error(mediaTooLargeMessage(maxBytes));
    }
    return localFile.blob;
  }

  const approxBytes = getLocalFileByteLength(localFile);
  if (approxBytes > maxBytes) {
    throw new Error(mediaTooLargeMessage(maxBytes));
  }

  const bytes = base64ToUint8(localFile?.bytesBase64 || "");
  if (bytes.length === 0) {
    throw new Error(UI_MESSAGES.popup.chooseFilesFirst);
  }
  if (bytes.length > maxBytes) {
    throw new Error(mediaTooLargeMessage(maxBytes));
  }

  const mimeType = String(localFile?.mimeType || "").trim().toLowerCase();
  return new Blob([bytes], {
    type: mimeType || "application/octet-stream",
  });
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

function normalizeResolvedHints(resolvedMediaUrlHint) {
  if (Array.isArray(resolvedMediaUrlHint)) {
    return [...new Set(resolvedMediaUrlHint.map((url) => normalizeHttpUrl(url)).filter(Boolean))];
  }

  const single = String(resolvedMediaUrlHint || "").trim();
  return single ? [normalizeHttpUrl(single)] : [];
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
        void reader.cancel();
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

export {
  blobFromConvertedPayload,
  buildLocalPseudoUrl,
  inferName,
  inferNameFromLocalFile,
  getLocalFileByteLength,
  materializeLocalFileBlob,
  mediaTooLargeMessage,
  normalizeHttpUrl,
  normalizeLocalFiles,
  normalizeOptionalHttpUrl,
  normalizeResolvedHints,
  readBlobSniffBytes,
  readBlobWithMaxSize,
  resolveMaxDownloadBytes,
};
