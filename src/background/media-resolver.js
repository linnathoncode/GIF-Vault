import { safeLog } from "../lib/log.js";

// URL resolution and media detection.
function isTwitterUrl(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    return (
      host.includes("twitter.com") ||
      host.includes("x.com") ||
      host.includes("twimg.com")
    );
  } catch {
    return false;
  }
}

async function resolveMediaUrl(rawUrl) {
  const urls = await resolveMediaUrls(rawUrl);
  return urls[0] || String(rawUrl || "");
}

async function resolveMediaUrls(rawUrl) {
  if (looksDirectMedia(rawUrl)) {
    return [rawUrl];
  }

  const directTweetId = extractTweetId(rawUrl);
  const baseUrl = directTweetId ? rawUrl : await expandUrl(rawUrl);
  if (looksDirectMedia(baseUrl)) {
    return [baseUrl];
  }

  const tweetId = directTweetId || extractTweetId(baseUrl);
  if (!tweetId) {
    return [baseUrl];
  }

  const fromSyndicationPromise = resolveFromSyndication(tweetId);
  const fromPagesPromise = resolveFromPages(tweetId, baseUrl);

  const fromSyndication = await fromSyndicationPromise;
  if (fromSyndication.length > 0) {
    return fromSyndication;
  }

  const fromPages = await fromPagesPromise;
  if (fromPages.length > 0) {
    return fromPages;
  }

  return [baseUrl];
}

function looksDirectMedia(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (host.includes("video.twimg.com") || host.includes("pbs.twimg.com")) {
      return true;
    }

    const path = url.pathname.toLowerCase();
    return (
      path.endsWith(".gif") ||
      path.endsWith(".mp4") ||
      path.endsWith(".webm") ||
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg")
    );
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

function collectMediaUrls(value, acc = []) {
  if (!value) {
    return acc;
  }
  if (typeof value === "string") {
    if (isLikelyTweetVideoUrl(value) || isLikelyTweetImageUrl(value)) {
      acc.push(value);
    }
    return acc;
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      collectMediaUrls(part, acc);
    }
    return acc;
  }
  if (typeof value === "object") {
    for (const part of Object.values(value)) {
      collectMediaUrls(part, acc);
    }
  }
  return acc;
}

function isLikelyTweetVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (!host.includes("video.twimg.com")) {
      return false;
    }
    return url.pathname.toLowerCase().includes(".mp4");
  } catch {
    return false;
  }
}

function isLikelyTweetImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (!host.includes("pbs.twimg.com")) {
      return false;
    }

    const path = url.pathname.toLowerCase();
    if (!path.includes("/media/")) {
      return false;
    }

    if (
      path.endsWith(".gif") ||
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".webp")
    ) {
      return true;
    }

    const format = (url.searchParams.get("format") || "").toLowerCase();
    return ["gif", "png", "jpg", "jpeg", "webp"].includes(format);
  } catch {
    return false;
  }
}

function mediaSortScore(url) {
  if (isLikelyTweetVideoUrl(url)) {
    const sizeMatch = url.match(/\/vid\/(\d+)x(\d+)\//);
    const area = sizeMatch ? Number(sizeMatch[1]) * Number(sizeMatch[2]) : 0;
    return 1_000_000 + area;
  }

  if (isLikelyTweetImageUrl(url)) {
    const name = (() => {
      try {
        return new URL(url).searchParams.get("name") || "";
      } catch {
        return "";
      }
    })();

    if (name === "orig") {
      return 500_000;
    }
    if (name === "4096x4096" || name === "large") {
      return 400_000;
    }
    if (name === "medium") {
      return 300_000;
    }
    return 200_000;
  }

  return 0;
}

function sortMediaUrls(urls) {
  if (!urls.length) {
    return [];
  }

  const unique = [...new Set(urls)];
  unique.sort((a, b) => mediaSortScore(b) - mediaSortScore(a));
  return unique;
}

async function resolveFromSyndication(tweetId) {
  try {
    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const urls = sortMediaUrls(collectMediaUrls(data));
    await safeLog("resolve", "Syndication lookup finished", {
      tweetId,
      foundCount: urls.length,
      picked: urls[0] || "",
    });
    return urls;
  } catch {
    await safeLog("resolve", "Syndication lookup failed", { tweetId });
    return [];
  }
}

async function resolveFromPages(tweetId, originalUrl) {
  const candidates = [
    `https://api.fxtwitter.com/status/${tweetId}`,
    `https://api.vxtwitter.com/status/${tweetId}`,
    `https://d.fxtwitter.com/i/status/${tweetId}`,
    `https://fxtwitter.com/i/status/${tweetId}`,
    `https://vxtwitter.com/i/status/${tweetId}`,
    `https://fixupx.com/i/status/${tweetId}`,
    originalUrl,
    `https://x.com/i/status/${tweetId}`,
    `https://twitter.com/i/status/${tweetId}`,
  ];

  for (const candidate of candidates) {
    const text = await fetchText(candidate);
    if (!text) {
      continue;
    }

    const urls = sortMediaUrls(extractMediaUrlsFromText(text));
    if (urls.length > 0) {
      await safeLog("resolve", "Resolved from page fallback", {
        tweetId,
        candidate,
        picked: urls[0],
        foundCount: urls.length,
      });
      return urls;
    }
  }

  await safeLog("resolve", "Page fallback failed", { tweetId });
  return [];
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

function extractMediaUrlsFromText(text) {
  const normalized = text.replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  const videoMatches =
    normalized.match(
      /https:\/\/video\.twimg\.com\/[^"'\\\s<>()]+\.mp4[^"'\\\s<>()]*/gi,
    ) || [];
  const imageMatches =
    normalized.match(/https:\/\/pbs\.twimg\.com\/media\/[^"'\\\s<>()]+/gi) || [];
  const merged = [...videoMatches, ...imageMatches];
  return [...new Set(merged)].filter(
    (rawUrl) => isLikelyTweetVideoUrl(rawUrl) || isLikelyTweetImageUrl(rawUrl),
  );
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
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    contentType.includes("octet-stream")
  );
}

function getReadableImportError(url, contentType) {
  const normalizedType = (contentType || "").toLowerCase();
  if (normalizedType.startsWith("text/html")) {
    return "Please enter a valid URL.";
  }
  if (isTwitterUrl(url)) {
    return "Could not resolve media from that post URL.";
  }
  return `Resolved URL is not media (${contentType || "unknown"})`;
}

export {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
  resolveMediaUrls,
};
