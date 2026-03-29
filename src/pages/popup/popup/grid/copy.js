import { fileExtensionFromMime } from "../../../../lib/media.js";
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

export async function copyItemBlob(item) {
  const canWriteBlob =
    navigator.clipboard &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined";

  if (canWriteBlob) {
    try {
      const ext = fileExtensionFromMime(item.mimeType);
      const file = new File([item.blob], `gif-vault-${item.id}.${ext}`, {
        type: item.mimeType || item.blob.type || "application/octet-stream",
      });
      await navigator.clipboard.write([
        new ClipboardItem({ [file.type]: file }),
      ]);
      await safeLog("popup", "Copy succeeded (blob)", {
        id: item.id,
        mimeType: file.type,
      });
      return { ok: true, method: "blob" };
    } catch (error) {
      await safeLog("popup", "Copy blob failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  const canWriteText =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    const copiedUrl = sanitizeCopyFallbackUrl(
      item.mediaUrl || item.sourceUrl || "",
    );
    if (!copiedUrl) {
      await safeLog("popup", "Copy url fallback blocked", {
        id: item.id,
      });
      return { ok: false, method: "none" };
    }
    try {
      await navigator.clipboard.writeText(copiedUrl);
      await safeLog("popup", "Copy fallback succeeded (url text)", {
        id: item.id,
      });
      return { ok: true, method: "url", copiedUrl };
    } catch (error) {
      await safeLog("popup", "Copy url fallback failed", {
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
