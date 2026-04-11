// Media helpers for preview URLs, hover previews, and stored media kind detection.
import { getWebpAnimationState } from "../../../../lib/media.js";
import { safeLog } from "../../../../lib/log.js";

const WEBP_ANIMATION_SNIFF_BYTES = 512;
const WEBP_ANIMATION_FALLBACK_SNIFF_BYTES = 16 * 1024;

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

export function createGridPreviewController({
  hoverPreviewEl,
  hoverPreviewImgEl,
  getPopupMenuConfig,
  objectUrlById,
  mediaKindCacheById,
}) {
  let hoverPreviewTimer = 0;
  let hoverPreviewSrc = "";
  let hoverPointerX = 0;
  let hoverPointerY = 0;

  function clearHoverPreviewTimer() {
    if (!hoverPreviewTimer) {
      return;
    }
    clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = 0;
  }

  function positionHoverPreview(x, y) {
    if (!hoverPreviewEl) {
      return;
    }

    const previewRect = hoverPreviewEl.getBoundingClientRect();
    const maxX = window.innerWidth - previewRect.width;
    const maxY = window.innerHeight - previewRect.height;
    let left = x;
    let top = y;

    if (left > maxX) {
      left = Math.max(0, x - previewRect.width);
    }
    if (top > maxY) {
      top = Math.max(0, y - previewRect.height);
    }

    hoverPreviewEl.style.left = `${Math.max(0, left)}px`;
    hoverPreviewEl.style.top = `${Math.max(0, top)}px`;
  }

  function hideHoverPreview() {
    clearHoverPreviewTimer();
    if (!hoverPreviewEl || !hoverPreviewImgEl) {
      return;
    }

    hoverPreviewEl.classList.remove("visible");
    hoverPreviewEl.setAttribute("aria-hidden", "true");
    hoverPreviewImgEl.removeAttribute("src");
    hoverPreviewSrc = "";
  }

  function showHoverPreview(previewUrl) {
    if (!getPopupMenuConfig().hoverPreviewEnabled) {
      return;
    }
    if (!hoverPreviewEl || !hoverPreviewImgEl || !previewUrl) {
      return;
    }

    if (hoverPreviewSrc !== previewUrl) {
      hoverPreviewImgEl.src = previewUrl;
      hoverPreviewSrc = previewUrl;
    }

    hoverPreviewEl.setAttribute("aria-hidden", "false");
    hoverPreviewEl.classList.add("visible");
    positionHoverPreview(hoverPointerX, hoverPointerY);
  }

  function updateHoverPointerPosition(event) {
    hoverPointerX = event?.clientX ?? hoverPointerX;
    hoverPointerY = event?.clientY ?? hoverPointerY;
  }

  function scheduleHoverPreview(previewUrl, event) {
    if (!getPopupMenuConfig().hoverPreviewEnabled) {
      hideHoverPreview();
      return;
    }

    updateHoverPointerPosition(event);
    clearHoverPreviewTimer();
    hoverPreviewTimer = setTimeout(() => {
      hoverPreviewTimer = 0;
      showHoverPreview(previewUrl);
    }, getPopupMenuConfig().hoverPreviewDelayMs);
  }

  function buildPreviewUrl(item) {
    if (!(item.blob instanceof Blob)) {
      void safeLog("popup", "Skipped preview: blob is invalid", {
        id: item.id,
        mimeType: item.mimeType || "",
        blobType: typeof item.blob,
      });
      return "";
    }

    const existing = objectUrlById.get(item.id);
    if (existing) {
      return existing;
    }

    const objectUrl = URL.createObjectURL(item.blob);
    objectUrlById.set(item.id, objectUrl);
    void safeLog("popup", "Created object URL for preview", {
      id: item.id,
      mimeType: item.mimeType || "",
      blobSize: item.blob?.size || 0,
    });
    return objectUrl;
  }

  function pruneObjectUrlsForVisibleIds(visibleIds) {
    for (const [id, url] of objectUrlById.entries()) {
      if (visibleIds.has(id)) {
        continue;
      }
      URL.revokeObjectURL(url);
      objectUrlById.delete(id);
      mediaKindCacheById.delete(String(id));
    }
  }

  function cleanupObjectUrls() {
    hideHoverPreview();
    for (const url of objectUrlById.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrlById.clear();
    mediaKindCacheById.clear();
  }

  return {
    buildPreviewUrl,
    cleanupObjectUrls,
    hideHoverPreview,
    positionHoverPreview,
    pruneObjectUrlsForVisibleIds,
    scheduleHoverPreview,
    updateHoverPointerPosition,
  };
}

export function createStoredMediaKindDetector(mediaKindCacheById) {
  return async function detectStoredMediaKind(item) {
    const itemId = String(item?.id || "");
    const mime = String(item?.mimeType || item?.blob?.type || "")
      .trim()
      .toLowerCase();
    const candidateUrl = String(item?.mediaUrl || item?.sourceUrl || "");
    const blobSize = item?.blob instanceof Blob ? item.blob.size : 0;
    const cacheKey = `${mime}|${blobSize}|${candidateUrl}`;
    const cached = mediaKindCacheById.get(itemId);
    if (cached?.cacheKey === cacheKey && cached?.mediaKind) {
      return cached.mediaKind;
    }

    if (mime.startsWith("video/") || isVideoLikeUrl(candidateUrl)) {
      mediaKindCacheById.set(itemId, { cacheKey, mediaKind: "video" });
      return "video";
    }
    if (mime.includes("image/gif") || isGifLikeUrl(candidateUrl)) {
      mediaKindCacheById.set(itemId, { cacheKey, mediaKind: "gif" });
      return "gif";
    }

    if (
      mime.includes("image/webp") &&
      item?.blob instanceof Blob &&
      item.blob.size > 0
    ) {
      // WebP needs byte sniffing because MIME type alone does not reveal animation.
      try {
        const primaryBytes = new Uint8Array(
          await item.blob.slice(0, WEBP_ANIMATION_SNIFF_BYTES).arrayBuffer(),
        );
        let animationState = getWebpAnimationState(primaryBytes);
        if (
          animationState === "indeterminate" &&
          item.blob.size > WEBP_ANIMATION_SNIFF_BYTES
        ) {
          const fallbackBytes = new Uint8Array(
            await item.blob
              .slice(0, WEBP_ANIMATION_FALLBACK_SNIFF_BYTES)
              .arrayBuffer(),
          );
          animationState = getWebpAnimationState(fallbackBytes);
        }

        if (animationState === "animated") {
          mediaKindCacheById.set(itemId, {
            cacheKey,
            mediaKind: "animated-webp",
          });
          return "animated-webp";
        }
        if (animationState === "indeterminate") {
          mediaKindCacheById.set(itemId, { cacheKey, mediaKind: "image" });
          return "image";
        }
      } catch (error) {
        await safeLog("popup", "Animated WebP detection failed", {
          id: item.id,
          error: error?.message || "unknown",
        });
      }
    }

    if (mime.startsWith("image/") || isImageLikeUrl(candidateUrl)) {
      mediaKindCacheById.set(itemId, { cacheKey, mediaKind: "image" });
      return "image";
    }

    mediaKindCacheById.set(itemId, { cacheKey, mediaKind: "unknown" });
    return "unknown";
  };
}
