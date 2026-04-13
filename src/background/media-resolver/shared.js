/**
 * Shared resolver helpers used by classifier and strategy modules.
 */
function hostMatches(rawHost, expectedHost) {
  const host = String(rawHost || "").toLowerCase();
  const expected = String(expectedHost || "").toLowerCase();
  return host === expected || host.endsWith(`.${expected}`);
}

function isTwitterUrl(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    return (
      hostMatches(host, "twitter.com") ||
      hostMatches(host, "x.com") ||
      hostMatches(host, "twimg.com")
    );
  } catch {
    return false;
  }
}

function looksDirectMedia(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (hostMatches(host, "video.twimg.com") || hostMatches(host, "pbs.twimg.com")) {
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

function isQuotedTweetBranchKey(key) {
  const normalized = String(key || "").toLowerCase();
  return (
    normalized === "qrt" ||
    normalized === "quote" ||
    normalized === "quoted" ||
    normalized === "quoted_status" ||
    normalized === "quotedstatus" ||
    normalized === "quoted_tweet" ||
    normalized === "quotedtweet" ||
    normalized === "quoted_tweet_result" ||
    normalized === "quotedtweetresult"
  );
}

function collectMediaUrls(value, acc = [], options = {}) {
  const includeQuoted = options.includeQuoted !== false;
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
      collectMediaUrls(part, acc, options);
    }
    return acc;
  }
  if (typeof value === "object") {
    for (const [key, part] of Object.entries(value)) {
      if (!includeQuoted && isQuotedTweetBranchKey(key)) {
        continue;
      }
      collectMediaUrls(part, acc, options);
    }
  }
  return acc;
}

function isLikelyTweetVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    if (!hostMatches(host, "video.twimg.com")) {
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
    if (!hostMatches(host, "pbs.twimg.com")) {
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
    return 1_000_000 + videoQualityPreferenceScore(url);
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

function parseVideoResolution(rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/\/(\d+)x(\d+)\//);
    if (!match) {
      return null;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

function videoQualityPreferenceScore(rawUrl) {
  const size = parseVideoResolution(rawUrl);
  if (!size) {
    return 0;
  }

  const shortEdge = Math.min(size.width, size.height);
  const area = size.width * size.height;
  if (shortEdge === 720) {
    return 500_000 + area;
  }
  if (shortEdge < 720) {
    return 300_000 + shortEdge * 100 + area / 1_000_000;
  }
  return 100_000 - (shortEdge - 720) * 100 + area / 1_000_000;
}

function sortMediaUrls(urls) {
  if (!urls.length) {
    return [];
  }

  const unique = [...new Set(urls)];
  unique.sort((a, b) => mediaSortScore(b) - mediaSortScore(a));
  return collapseVariantUrls(unique);
}

function collapseVariantUrls(sortedUrls) {
  const seenKeys = new Set();
  const collapsed = [];

  for (const rawUrl of sortedUrls) {
    const key = getVariantCollapseKey(rawUrl);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    collapsed.push(rawUrl);
  }

  return collapsed;
}

function getVariantCollapseKey(rawUrl) {
  if (isLikelyTweetVideoUrl(rawUrl)) {
    return getVideoVariantKey(rawUrl);
  }
  if (isLikelyTweetImageUrl(rawUrl)) {
    return getImageVariantKey(rawUrl);
  }
  return `other:${rawUrl}`;
}

function getVideoVariantKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    let normalizedPath = url.pathname.toLowerCase();

    normalizedPath = normalizedPath.replace(/\/\d+x\d+(?=\/)/g, "/*");
    normalizedPath = normalizedPath.replace(/\/vid\/[^/]+\/\*(?=\/)/, "/vid/*");
    normalizedPath = normalizedPath.replace(/\/[^/]+\.mp4$/i, "");

    return `video:${host}${normalizedPath}`;
  } catch {
    return `video:${rawUrl}`;
  }
}

function getImageVariantKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.host.toLowerCase();
    const path = url.pathname.toLowerCase();
    const format = (url.searchParams.get("format") || "").toLowerCase();
    const normalizedPath = format && !/\.(png|jpe?g|gif|webp)$/i.test(path)
      ? `${path}.${format}`
      : path;
    return `image:${host}${normalizedPath}`;
  } catch {
    return `image:${rawUrl}`;
  }
}

function hasLikelyMediaUrlHint(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.toLowerCase();
    if (/\.(gif|png|jpe?g|webp|bmp|avif|mp4|webm|mov|m4v)$/i.test(path)) {
      return true;
    }
    const format = (url.searchParams.get("format") || "").toLowerCase();
    return ["gif", "png", "jpg", "jpeg", "webp", "bmp", "avif"].includes(format);
  } catch {
    return false;
  }
}

function inferMediaTypeFromMagicBytes(sniffBytes) {
  const bytes = sniffBytes instanceof Uint8Array ? sniffBytes : new Uint8Array();
  if (bytes.length < 4) {
    return "";
  }

  const asciiAt = (offset, text) => {
    if (offset + text.length > bytes.length) {
      return false;
    }
    for (let i = 0; i < text.length; i += 1) {
      if (bytes[offset + i] !== text.charCodeAt(i)) {
        return false;
      }
    }
    return true;
  };

  if (asciiAt(0, "GIF8")) {
    return "image/gif";
  }
  if (bytes[0] === 0x89 && asciiAt(1, "PNG")) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (asciiAt(0, "RIFF") && asciiAt(8, "WEBP")) {
    return "image/webp";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  if (asciiAt(4, "ftyp")) {
    return "video/mp4";
  }

  return "";
}

function isSupportedMediaType(contentType, options = {}) {
  const normalizedType = String(contentType || "").trim().toLowerCase();
  if (
    normalizedType.startsWith("image/") ||
    normalizedType.startsWith("video/")
  ) {
    return true;
  }

  const isBinaryFallback =
    !normalizedType || normalizedType.includes("octet-stream");
  if (!isBinaryFallback) {
    return false;
  }

  if (hasLikelyMediaUrlHint(options.url || "")) {
    return true;
  }

  const inferredType = inferMediaTypeFromMagicBytes(options.sniffBytes);
  return inferredType.startsWith("image/") || inferredType.startsWith("video/");
}

export {
  collectMediaUrls,
  extractTweetId,
  isLikelyTweetImageUrl,
  isLikelyTweetVideoUrl,
  isSupportedMediaType,
  isTwitterUrl,
  looksDirectMedia,
  sortMediaUrls,
};
