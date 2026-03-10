import { idbSave, idbLog } from "../lib/db.js";
import { extensionFromUrl } from "../lib/media.js";
import { STORAGE_KEYS, CONTEXT_MENU, OFFSCREEN, GIF_CONVERSION, BADGE, ICONS } from "../lib/settings.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU.addToVaultId,
    title: "Add to GIF Vault",
    contexts: ["image", "video"]
  });
  void syncActionIconToTheme();
});

chrome.runtime.onStartup.addListener(() => {
  void syncActionIconToTheme();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.themeMode]) {
    return;
  }
  const nextTheme = changes[STORAGE_KEYS.themeMode].newValue === "dark" ? "dark" : "light";
  void setActionIcon(nextTheme);
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU.addToVaultId || !info.srcUrl) {
    return;
  }

  try {
    await safeLog("context-menu", "Context menu click received", { srcUrl: info.srcUrl, pageUrl: info.pageUrl || "" });
    await importFromUrl(info.srcUrl, info.pageUrl || "");
    await showBadgeFallback(true);
  } catch (error) {
    if (String(error?.message || "").startsWith("Host access needed for ")) {
      await openPermissionAssist(info.srcUrl, info.pageUrl || "", error.message);
    }
    await showBadgeFallback(false);
    await safeLog("context-menu", "Context menu import failed", { error: error?.message || "unknown" });
    // Context-menu saves are fire-and-forget.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "SET_THEME_ICON") {
    const theme = message.theme === "dark" ? "dark" : "light";
    void safeLog("theme", "SET_THEME_ICON request received", { theme });
    setActionIcon(theme)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await safeLog("theme", "SET_THEME_ICON failed", { theme, error: error?.message || "unknown" });
        sendResponse({ ok: false, error: error?.message || "Failed to set icon" });
      });
    return true;
  }

  if (message.type === "RESOLVE_MEDIA_URL") {
    resolveMediaUrl(message.url || "")
      .then((resolvedMediaUrl) => sendResponse({ ok: true, resolvedMediaUrl }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Resolve failed" }));
    return true;
  }

  if (message.type !== "IMPORT_URL") {
    return;
  }

  importFromUrl(message.url, message.pageUrl || "", message.requestId || "")
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Import failed" }));

  return true;
});

async function importFromUrl(rawUrl, pageUrl, requestId = "") {
  const progressId = requestId || crypto.randomUUID();
  const url = String(rawUrl || "").trim();
  if (!url) {
    await safeLog("import", "Rejected empty URL");
    throw new Error("Empty URL");
  }
  await reportProgress(progressId, "Resolving media URL...", true, "info");
  try {
    await safeLog("import", "Import started", { url, pageUrl: pageUrl || "" });
    await ensureOriginAccess(url);

    const resolvedMediaUrl = await resolveMediaUrl(url);
    if (!resolvedMediaUrl) {
      await safeLog("resolve", "Failed to resolve media URL", { url });
      throw new Error("Could not resolve media URL");
    }
    await safeLog("resolve", "Resolved media URL", { url, resolvedMediaUrl });
    await ensureOriginAccess(resolvedMediaUrl);

    await reportProgress(progressId, "Fetching media...", true, "info");
    const response = await fetch(resolvedMediaUrl);
    if (!response.ok) {
      await safeLog("fetch", "Fetch failed", { resolvedMediaUrl, status: response.status });
      throw new Error("Failed to fetch media");
    }
    await safeLog("fetch", "Fetch succeeded", { resolvedMediaUrl, status: response.status });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!isSupportedMediaType(contentType)) {
      await safeLog("fetch", "Rejected non-media response", { resolvedMediaUrl, contentType });
      throw new Error(`Resolved URL is not media (${contentType || "unknown"})`);
    }

    const inputBlob = await response.blob();
    const ext = extensionFromUrl(resolvedMediaUrl, inputBlob.type);
    const isMp4 = ext === "mp4" || (inputBlob.type || "").includes("mp4");
    const needsTwitterConvert = isMp4 && isTwitterUrl(url);

    let finalBlob = inputBlob;
    let finalMime = inputBlob.type || (isMp4 ? "video/mp4" : "image/gif");
    let converted = false;

    if (needsTwitterConvert) {
      await reportProgress(progressId, "Converting MP4 to GIF...", true, "info");
      await safeLog("convert", "Twitter MP4 detected, offscreen conversion requested", { resolvedMediaUrl });
      try {
        const convertedPayload = await convertInOffscreen(resolvedMediaUrl, `vault-${Date.now()}.gif`);
        const rebuiltBlob = blobFromConvertedPayload(convertedPayload);
        await safeLog("convert", "Offscreen conversion response received", {
          converted: Boolean(convertedPayload?.converted),
          mimeType: convertedPayload?.mimeType || "",
          reason: convertedPayload?.reason || "",
          hasGifBase64: Boolean(convertedPayload?.gifBase64),
          gifBase64Length: convertedPayload?.gifBase64 ? convertedPayload.gifBase64.length : 0,
          gifByteLength: convertedPayload?.gifByteLength || 0,
          hasGifBuffer: Boolean(convertedPayload?.gifBuffer),
          rebuiltBlobSize: rebuiltBlob?.size || 0
        });

        if (rebuiltBlob && rebuiltBlob.size > 0) {
          finalBlob = rebuiltBlob;
          finalMime = convertedPayload.mimeType || "image/gif";
          converted = Boolean(convertedPayload.converted);
        } else {
          await safeLog("convert", "Offscreen payload had no usable blob, keeping original media", {
            mimeType: convertedPayload?.mimeType || "",
            reason: convertedPayload?.reason || ""
          });
        }
      } catch (error) {
        if (String(error?.message || "").startsWith("VIDEO_TOO_LONG:")) {
          const seconds = Number.parseFloat(String(error.message).split(":")[1] || "0");
          await safeLog("convert", "Rejected long video in background", {
            durationSeconds: seconds,
            maxDurationSeconds: GIF_CONVERSION.maxDurationSeconds
          });
          throw new Error(`Video is too long (${seconds.toFixed(1)}s). Max allowed is ${GIF_CONVERSION.maxDurationSeconds}s.`);
        }
        await safeLog("convert", "Offscreen conversion threw, keeping original media", {
          error: error?.message || "unknown"
        });
      }
    }

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
      savedAt: Date.now()
    };

    await idbSave(item);
    await safeLog("save", "Media saved to IndexedDB", {
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      blobSize: item.blob?.size || 0,
      converted: item.converted
    });
    await notifyVaultUpdated(item.id);
    await reportProgress(progressId, "Imported successfully.", false, "success");
    return { id: item.id, kind: item.kind, converted };
  } catch (error) {
    const message = error?.message || "Import failed";
    await reportProgress(progressId, message, false, "error");
    throw error;
  }
}

function isTwitterUrl(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    return host.includes("twitter.com") || host.includes("x.com") || host.includes("twimg.com");
  } catch {
    return false;
  }
}

async function resolveMediaUrl(rawUrl) {
  const expandedUrl = await expandUrl(rawUrl);

  if (looksDirectMedia(expandedUrl)) {
    return expandedUrl;
  }

  const tweetId = extractTweetId(expandedUrl);
  if (!tweetId) {
    return expandedUrl;
  }

  const fromSyndication = await resolveFromSyndication(tweetId);
  if (fromSyndication) {
    return fromSyndication;
  }

  const fromPages = await resolveFromPages(tweetId, expandedUrl);
  if (fromPages) {
    return fromPages;
  }

  return expandedUrl;
}

function looksDirectMedia(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (host.includes("video.twimg.com") || host.includes("pbs.twimg.com")) {
      return true;
    }
    const path = url.pathname.toLowerCase();
    return path.endsWith(".gif") || path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg");
  } catch {
    return false;
  }
}

function extractTweetId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/status\/(\d+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function collectVideoUrls(value, acc = []) {
  if (!value) {
    return acc;
  }

  if (typeof value === "string") {
    if (value.includes("video.twimg.com") && value.includes(".mp4")) {
      acc.push(value);
    }
    return acc;
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      collectVideoUrls(part, acc);
    }
    return acc;
  }

  if (typeof value === "object") {
    for (const part of Object.values(value)) {
      collectVideoUrls(part, acc);
    }
  }

  return acc;
}

function pickBestVideoUrl(urls) {
  if (!urls.length) {
    return "";
  }

  const unique = [...new Set(urls)];
  unique.sort((a, b) => {
    const aMatch = a.match(/\/vid\/(\d+)x(\d+)\//);
    const bMatch = b.match(/\/vid\/(\d+)x(\d+)\//);
    const aArea = aMatch ? Number(aMatch[1]) * Number(aMatch[2]) : 0;
    const bArea = bMatch ? Number(bMatch[1]) * Number(bMatch[2]) : 0;
    return bArea - aArea;
  });

  return unique[0];
}

async function resolveFromSyndication(tweetId) {
  try {
    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const urls = collectVideoUrls(data);
    const picked = pickBestVideoUrl(urls);
    await safeLog("resolve", "Syndication lookup finished", { tweetId, foundCount: urls.length, picked: picked || "" });
    return picked;
  } catch {
    await safeLog("resolve", "Syndication lookup failed", { tweetId });
    return "";
  }
}

async function resolveFromPages(tweetId, originalUrl) {
  const candidates = [
    originalUrl,
    `https://x.com/i/status/${tweetId}`,
    `https://twitter.com/i/status/${tweetId}`,
    `https://fixupx.com/i/status/${tweetId}`,
    `https://fxtwitter.com/i/status/${tweetId}`,
    `https://vxtwitter.com/i/status/${tweetId}`,
    `https://d.fxtwitter.com/i/status/${tweetId}`,
    `https://api.fxtwitter.com/status/${tweetId}`,
    `https://api.vxtwitter.com/status/${tweetId}`
  ];

  for (const candidate of candidates) {
    const text = await fetchText(candidate);
    if (!text) {
      continue;
    }

    const urls = extractVideoUrlsFromText(text);
    const picked = pickBestVideoUrl(urls);
    if (picked) {
      await safeLog("resolve", "Resolved from page fallback", { tweetId, candidate, picked });
      return picked;
    }
  }

  await safeLog("resolve", "Page fallback failed", { tweetId });
  return "";
}

async function fetchText(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

function extractVideoUrlsFromText(text) {
  const normalized = text
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  const matches = normalized.match(/https:\/\/video\.twimg\.com\/[^"'\\\s<>()]+\.mp4[^"'\\\s<>()]*/gi) || [];
  return [...new Set(matches)];
}

async function expandUrl(rawUrl) {
  try {
    const response = await fetch(rawUrl);
    return response.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

function isSupportedMediaType(contentType) {
  if (!contentType) {
    return true;
  }
  return contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.includes("octet-stream");
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN.url,
    reasons: ["BLOBS"],
    justification: "Convert imported MP4 media into GIF in background"
  });
}

async function convertInOffscreen(url, filename) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONVERT_MP4",
    url,
    filename
  });

  if (!response?.ok) {
    await safeLog("convert", "Offscreen conversion failed", { error: response?.error || "unknown" });
    throw new Error(response?.error || "Offscreen conversion failed");
  }

  return response.payload;
}

async function safeLog(stage, message, details = {}) {
  try {
    await idbLog(stage, message, details);
  } catch {
    // Logging should never break the import pipeline.
  }
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

async function ensureOriginAccess(rawUrl) {
  const originPattern = originPatternFromUrl(rawUrl);
  if (!originPattern) {
    return;
  }

  const hasAccess = await chrome.permissions.contains({
    origins: [originPattern]
  });

  if (hasAccess) {
    return;
  }

  await safeLog("permissions", "Missing host access for origin", { origin: originPattern });
  throw new Error(`Host access needed for ${originPattern}. Use popup import to grant access.`);
}

function originPatternFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return "";
  }
}

async function reportProgress(requestId, text, active = true, kind = "info") {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.importState]: {
        requestId,
        text,
        kind,
        active: Boolean(active),
        updatedAt: Date.now()
      }
    });

    await chrome.runtime.sendMessage({
      type: "IMPORT_PROGRESS",
      requestId,
      text,
      kind,
      active: Boolean(active)
    });
  } catch {
    // Popup may be closed; ignore progress delivery failures.
  }
}

async function notifyVaultUpdated(itemId) {
  try {
    await chrome.runtime.sendMessage({
      type: "VAULT_UPDATED",
      itemId
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

async function showBadgeFallback(ok) {
  try {
    await chrome.action.setBadgeBackgroundColor({
      color: ok ? BADGE.okColor : BADGE.errorColor
    });
    await chrome.action.setBadgeText({
      text: ok ? BADGE.okText : BADGE.errorText
    });
    // Best-effort clear; if worker sleeps early, badge may persist until next action.
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, BADGE.clearDelayMs);
  } catch {
    // no-op
  }
}

async function syncActionIconToTheme() {
  try {
    const current = await chrome.storage.local.get([STORAGE_KEYS.themeMode]);
    const theme = current[STORAGE_KEYS.themeMode] === "dark" ? "dark" : "light";
    await setActionIcon(theme);
  } catch {
    // no-op
  }
}

async function setActionIcon(theme) {
  const iconPaths = theme === "dark" ? ICONS.dark : ICONS.light;
  await setIconWithImageData(iconPaths);
  await safeLog("theme", "Action icon updated (imageData)", { theme });
}

async function openPermissionAssist(url, pageUrl, reason) {
  try {
    const assistUrl = new URL(chrome.runtime.getURL("assist/permission-assist.html"));
    assistUrl.searchParams.set("url", url || "");
    if (pageUrl) {
      assistUrl.searchParams.set("pageUrl", pageUrl);
    }
    if (reason) {
      assistUrl.searchParams.set("reason", reason);
    }
    await chrome.tabs.create({ url: assistUrl.toString() });
    await safeLog("context-menu", "Opened permission assist tab", { url, pageUrl, reason });
  } catch (error) {
    await safeLog("context-menu", "Failed to open permission assist tab", { error: error?.message || "unknown" });
  }
}

async function setIconWithImageData(iconPaths) {
  const imageData16 = await iconPathToImageData(iconPaths["16"], 16);
  const imageData32 = await iconPathToImageData(iconPaths["32"], 32);
  await new Promise((resolve, reject) => {
    chrome.action.setIcon(
      {
        imageData: {
          16: imageData16,
          32: imageData32
        }
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || "Failed to set action icon via imageData"));
          return;
        }
        resolve();
      }
    );
  });
}

async function iconPathToImageData(path, size) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load icon asset: ${path}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D context for icon rendering");
  }
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}
