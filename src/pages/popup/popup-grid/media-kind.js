import { getWebpAnimationState } from "../../../lib/media.js";
import { safeLog } from "../../../lib/log.js";
import { isGifLikeUrl, isImageLikeUrl, isVideoLikeUrl } from "./copy.js";

const WEBP_ANIMATION_SNIFF_BYTES = 512;
const WEBP_ANIMATION_FALLBACK_SNIFF_BYTES = 16 * 1024;

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
