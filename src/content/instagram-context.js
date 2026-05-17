/**
 * Tracks the last right-clicked media element on Instagram pages so the
 * background context-menu handler can import the exact clicked item.
 */
const INSTAGRAM_CONTEXT_MEDIA_STORAGE_KEY = "instagramContextMedia";
const INSTAGRAM_CONTEXT_DEBUG_STORAGE_KEY = "instagramContextDebug";

const SUPPORTED_MEDIA_SELECTOR = "img[src], video[src], video source[src]";
const MAX_AGE_MS = 10_000;
const DEBUG_MAX_AGE_MS = 30_000;
let lastKnownPageUrl = window.location.href;

function toAbsoluteHttpUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function findMediaElementFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const directMatch = target.closest(SUPPORTED_MEDIA_SELECTOR);
  if (directMatch) {
    return directMatch;
  }

  const parent = target.closest("article, [role='dialog'], main, section, div");
  if (!parent) {
    return null;
  }

  return parent.querySelector(SUPPORTED_MEDIA_SELECTOR);
}

function findMediaElementFromEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof Element)) {
      continue;
    }
    const direct = node.matches?.(SUPPORTED_MEDIA_SELECTOR) ? node : null;
    if (direct) {
      return direct;
    }
    const nested = node.querySelector?.(SUPPORTED_MEDIA_SELECTOR) || null;
    if (nested) {
      return nested;
    }
  }
  return findMediaElementFromTarget(event.target);
}

function resolveMediaUrl(element) {
  if (!element) {
    return { mediaUrl: "", mediaKind: "" };
  }

  if (element instanceof HTMLImageElement) {
    return {
      mediaUrl: toAbsoluteHttpUrl(element.currentSrc || element.src),
      mediaKind: "image",
    };
  }

  if (element instanceof HTMLVideoElement) {
    return {
      mediaUrl: toAbsoluteHttpUrl(element.currentSrc || element.src),
      mediaKind: "video",
    };
  }

  if (element instanceof HTMLSourceElement) {
    return {
      mediaUrl: toAbsoluteHttpUrl(element.src),
      mediaKind: "video",
    };
  }

  return { mediaUrl: "", mediaKind: "" };
}

async function storeContextMedia(mediaUrl, mediaKind) {
  const payload = {
    mediaUrl,
    mediaKind,
    pageUrl: window.location.href,
    capturedAt: Date.now(),
    maxAgeMs: MAX_AGE_MS,
  };

  try {
    await chrome.storage.local.set({
      [INSTAGRAM_CONTEXT_MEDIA_STORAGE_KEY]: payload,
      [INSTAGRAM_CONTEXT_DEBUG_STORAGE_KEY]: {
        ok: true,
        reason: "captured",
        mediaUrl,
        mediaKind,
        pageUrl: window.location.href,
        capturedAt: payload.capturedAt,
        maxAgeMs: DEBUG_MAX_AGE_MS,
      },
    });
  } catch {
    // Best effort only; import still works for direct image/video context.
  }
}

async function storeContextDebug(reason) {
  try {
    await chrome.storage.local.set({
      [INSTAGRAM_CONTEXT_DEBUG_STORAGE_KEY]: {
        ok: false,
        reason,
        pageUrl: window.location.href,
        capturedAt: Date.now(),
        maxAgeMs: DEBUG_MAX_AGE_MS,
      },
    });
  } catch {
    // no-op
  }
}

async function clearStaleContextOnPageChange(nextPageUrl) {
  try {
    await chrome.storage.local.remove(INSTAGRAM_CONTEXT_MEDIA_STORAGE_KEY);
    await chrome.storage.local.set({
      [INSTAGRAM_CONTEXT_DEBUG_STORAGE_KEY]: {
        ok: false,
        reason: "page-url-changed-cleared-stale-context",
        pageUrl: nextPageUrl,
        capturedAt: Date.now(),
        maxAgeMs: DEBUG_MAX_AGE_MS,
      },
    });
  } catch {
    // no-op
  }
}

function handlePossibleSpaNavigation() {
  const nextPageUrl = window.location.href;
  if (nextPageUrl === lastKnownPageUrl) {
    return;
  }
  lastKnownPageUrl = nextPageUrl;
  void clearStaleContextOnPageChange(nextPageUrl);
}

function handlePointerLikeEvent(event) {
  const mediaElement = findMediaElementFromEvent(event);
  const { mediaUrl, mediaKind } = resolveMediaUrl(mediaElement);
  if (!mediaUrl) {
    void storeContextDebug("no-media-from-event-target");
    return;
  }
  void storeContextMedia(mediaUrl, mediaKind);
}

document.addEventListener(
  "contextmenu",
  (event) => {
    handlePointerLikeEvent(event);
  },
  { capture: true },
);

document.addEventListener(
  "mousedown",
  (event) => {
    if (event.button !== 2) {
      return;
    }
    handlePointerLikeEvent(event);
  },
  { capture: true },
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (event.button !== 2) {
      return;
    }
    handlePointerLikeEvent(event);
  },
  { capture: true },
);

window.addEventListener("popstate", () => {
  handlePossibleSpaNavigation();
});

window.addEventListener("hashchange", () => {
  handlePossibleSpaNavigation();
});

setInterval(() => {
  handlePossibleSpaNavigation();
}, 500);
