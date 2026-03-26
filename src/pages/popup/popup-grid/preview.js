import { safeLog } from "../../../lib/log.js";

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
