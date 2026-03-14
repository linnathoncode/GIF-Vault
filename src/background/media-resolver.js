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
  if (looksDirectMedia(rawUrl)) {
    return rawUrl;
  }

  const directTweetId = extractTweetId(rawUrl);
  const baseUrl = directTweetId ? rawUrl : await expandUrl(rawUrl);
  if (looksDirectMedia(baseUrl)) {
    return baseUrl;
  }

  const tweetId = directTweetId || extractTweetId(baseUrl);
  if (!tweetId) {
    return baseUrl;
  }

  const fromSyndicationPromise = resolveFromSyndication(tweetId);
  const fromPagesPromise = resolveFromPages(tweetId, baseUrl);

  const fromSyndication = await fromSyndicationPromise;
  if (fromSyndication) {
    return fromSyndication;
  }

  const fromPages = await fromPagesPromise;
  if (fromPages) {
    return fromPages;
  }

  return baseUrl;
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
    await safeLog("resolve", "Syndication lookup finished", {
      tweetId,
      foundCount: urls.length,
      picked: picked || "",
    });
    return picked;
  } catch {
    await safeLog("resolve", "Syndication lookup failed", { tweetId });
    return "";
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

    const urls = extractVideoUrlsFromText(text);
    const picked = pickBestVideoUrl(urls);
    if (picked) {
      await safeLog("resolve", "Resolved from page fallback", {
        tweetId,
        candidate,
        picked,
      });
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
  const normalized = text.replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  const matches =
    normalized.match(
      /https:\/\/video\.twimg\.com\/[^"'\\\s<>()]+\.mp4[^"'\\\s<>()]*/gi,
    ) || [];
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
};
