import { safeLog } from "../../../../lib/log.js";

export function sanitizeCopyFallbackUrl(candidateUrl) {
  const normalized = String(candidateUrl || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return "";
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return "";
  }

  return parsedUrl.toString();
}

export function sanitizeCopyFallbackLocalPath(candidatePath) {
  const normalized = String(candidatePath || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) {
    return "";
  }

  if (/^file:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      if (parsedUrl.protocol.toLowerCase() === "file:") {
        return parsedUrl.toString();
      }
    } catch {
      return "";
    }
    return "";
  }

  const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(normalized);
  const isUncPath = /^\\\\[^\\]/.test(normalized);
  const isUnixAbsolutePath = /^\//.test(normalized);
  const isRelativePath =
    /[\\/]/.test(normalized) && !/^[a-z][a-z0-9+.-]*:/i.test(normalized);

  if (isWindowsDrivePath || isUncPath || isUnixAbsolutePath || isRelativePath) {
    return normalized;
  }

  return "";
}

export async function copyItemUrl(item) {
  const canWriteText =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    const copiedUrl = sanitizeCopyFallbackUrl(
      item.mediaUrl || item.sourceUrl || "",
    );
    const copiedLocalPath = sanitizeCopyFallbackLocalPath(
      item.localPath ||
        item.sourcePath ||
        item.filePath ||
        "",
    );
    const copiedText = copiedLocalPath || copiedUrl;
    if (!copiedText) {
      await safeLog("popup", "Copy url blocked", { id: item.id });
      const hasNoSourceUrl = !String(item?.mediaUrl || item?.sourceUrl || "").trim();
      if (hasNoSourceUrl) {
        return { ok: false, method: "none", reason: "no-source-url" };
      }
      return { ok: false, method: "none", reason: "blocked" };
    }

    try {
      await navigator.clipboard.writeText(copiedText);
      await safeLog(
        "popup",
        copiedLocalPath
          ? "Copy succeeded (local path text)"
          : "Copy succeeded (url text)",
        { id: item.id },
      );
      return {
        ok: true,
        method: copiedLocalPath ? "local-path" : "url",
        copiedUrl: copiedText,
      };
    } catch (error) {
      await safeLog("popup", "Copy url failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  return { ok: false, method: "none" };
}

export function isVideoLikeUrl(url) {
  return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(url || ""));
}

export function isGifLikeUrl(url) {
  const value = String(url || "");
  return (
    /\.gif(?:$|[?#])/i.test(value) ||
    /[?&]format=gif(?:$|&)/i.test(value)
  );
}

export function isImageLikeUrl(url) {
  const value = String(url || "");
  return (
    /\.(png|jpe?g|webp|bmp|avif|heic|heif|svg)(?:$|[?#])/i.test(value) ||
    /[?&]format=(?:png|jpe?g|webp|bmp|avif)(?:$|&)/i.test(value)
  );
}

export function resolveMediaCopyKind(item, copiedUrl = "") {
  if (
    item?.mediaKind === "gif" ||
    item?.mediaKind === "image" ||
    item?.mediaKind === "video" ||
    item?.mediaKind === "animated-webp"
  ) {
    return item.mediaKind;
  }

  const mime = String(item?.mimeType || item?.blob?.type || "")
    .trim()
    .toLowerCase();
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime.includes("image/gif")) {
    return "gif";
  }
  if (mime.startsWith("image/")) {
    return "image";
  }

  if (isVideoLikeUrl(copiedUrl)) {
    return "video";
  }
  if (isGifLikeUrl(copiedUrl)) {
    return "gif";
  }
  if (isImageLikeUrl(copiedUrl)) {
    return "image";
  }

  return "unknown";
}
