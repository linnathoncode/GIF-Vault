/**
 * URL resolution strategies grouped by source class.
 */
import { safeLog } from "../../lib/log.js";
import {
  collectMediaUrls,
  isLikelyTweetImageUrl,
  isLikelyTweetVideoUrl,
  sortMediaUrls,
} from "./shared.js";

async function resolveDirectMediaUrls(url) {
  const value = String(url || "").trim();
  return value ? [value] : [];
}

async function resolveTwitterPostUrls(tweetId, originalUrl = "") {
  const fromSyndicationPromise = resolveFromSyndication(tweetId);
  const fromPagesPromise = resolveFromPages(tweetId, originalUrl);

  const fromSyndication = await fromSyndicationPromise;
  if (fromSyndication.length > 0) {
    return fromSyndication;
  }

  const fromPages = await fromPagesPromise;
  if (fromPages.length > 0) {
    return fromPages;
  }

  return [];
}

async function resolveHtmlEmbedUrls(pageUrl) {
  const text = await fetchText(pageUrl);
  if (!text) {
    return [];
  }

  const candidates = extractMediaUrlsFromHtml(text, pageUrl);
  if (candidates.length > 0) {
    await safeLog("resolve", "Resolved media from embedded HTML metadata", {
      pageUrl,
      foundCount: candidates.length,
      picked: candidates[0] || "",
    });
  }
  return candidates;
}

async function expandUrl(rawUrl) {
  try {
    const response = await fetch(rawUrl);
    return response.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

async function resolveFromSyndication(tweetId) {
  try {
    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const urls = sortMediaUrls(collectMediaUrls(data, [], { includeQuoted: false }));
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

    const urls = extractMediaUrlsFromResponseText(text);
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

function extractMediaUrlsFromResponseText(text) {
  const normalizedText = String(text || "");
  const structuredUrls = collectMediaUrls(
    tryParseJson(normalizedText),
    [],
    { includeQuoted: false },
  );
  if (structuredUrls.length > 0) {
    return sortMediaUrls(structuredUrls);
  }
  return sortMediaUrls(extractMediaUrlsFromText(normalizedText));
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMediaUrlsFromHtml(text, pageUrl) {
  const canonicalPageUrl = canonicalizeHttpUrl(pageUrl);
  const metaCandidates = extractMetaMediaUrls(text);
  const normalizedMeta = metaCandidates
    .map((raw) => toAbsoluteHttpUrl(raw, pageUrl))
    .filter(Boolean)
    .filter((url) => canonicalizeHttpUrl(url) !== canonicalPageUrl);

  // When page metadata exposes media URLs, trust that as the primary signal.
  if (normalizedMeta.length > 0) {
    return [...new Set(normalizedMeta)];
  }

  const tagCandidates = extractTagMediaUrls(text);
  const textCandidates = extractPlainTextMediaUrls(text);
  const merged = [...tagCandidates, ...textCandidates];
  const normalizedFallback = merged
    .map((raw) => toAbsoluteHttpUrl(raw, pageUrl))
    .filter(Boolean)
    .filter((url) => canonicalizeHttpUrl(url) !== canonicalPageUrl);
  return [...new Set(normalizedFallback)];
}

function extractMetaMediaUrls(text) {
  const metaUrls = [];
  const metaTags = String(text || "").match(/<meta\b[^>]*>/gi) || [];
  const mediaMetaKeys = new Set([
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
    "og:video",
    "og:video:url",
  ]);

  for (const tag of metaTags) {
    const attrs = parseTagAttributes(tag);
    const key = String(attrs.property || attrs.name || "").toLowerCase();
    const content = String(attrs.content || "").trim();
    if (!content || !mediaMetaKeys.has(key)) {
      continue;
    }
    metaUrls.push(content);
  }

  return metaUrls;
}

function extractTagMediaUrls(text) {
  const matches = String(text || "").match(/<(img|source)\b[^>]*>/gi) || [];
  const urls = [];
  for (const tag of matches) {
    const attrs = parseTagAttributes(tag);
    const src = String(attrs.src || "").trim();
    if (src) {
      urls.push(src);
    }
  }
  return urls;
}

function extractPlainTextMediaUrls(text) {
  const normalized = String(text || "").replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  const matches =
    normalized.match(
      /https?:\/\/[^"'\s<>()]+?\.(?:gif|png|jpe?g|webp|bmp|avif|mp4|webm|mov|m4v)(?:\?[^"'\s<>()]*)?/gi,
    ) || [];
  return [...new Set(matches)];
}

function parseTagAttributes(tagText) {
  const attrs = {};
  const regex = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match = regex.exec(tagText);
  while (match) {
    const key = String(match[1] || "").toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[key] = value;
    match = regex.exec(tagText);
  }
  return attrs;
}

function toAbsoluteHttpUrl(rawUrl, baseUrl) {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) {
    return "";
  }
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return "";
    }
    return resolved.toString();
  } catch {
    return "";
  }
}

function canonicalizeHttpUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export {
  expandUrl,
  resolveDirectMediaUrls,
  resolveHtmlEmbedUrls,
  resolveTwitterPostUrls,
};
