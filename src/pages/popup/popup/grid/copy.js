import { safeLog } from "../../../../lib/log.js";

export function sanitizeCopyUrl(candidateUrl) {
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

export async function copyItemUrl(item) {
  const canWriteText =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    const copiedUrl = sanitizeCopyUrl(
      item.mediaUrl || item.sourceUrl || "",
    );
    if (!copiedUrl) {
      const hasNoSourceUrl = !String(item?.mediaUrl || item?.sourceUrl || "").trim();
      if (hasNoSourceUrl) {
        await safeLog("popup", "Copy failed (local path does not have URL)", {
          id: item.id,
        });
        return { ok: false, method: "none", reason: "no-source-url" };
      }
      await safeLog("popup", "Copy failed (local path does not have URL)", {
        id: item.id,
      });
      return { ok: false, method: "none", reason: "blocked" };
    }

    try {
      await navigator.clipboard.writeText(copiedUrl);
      await safeLog("popup", "Copy succeeded (url text)", { id: item.id });
      return {
        ok: true,
        method: "url",
        copiedUrl,
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
