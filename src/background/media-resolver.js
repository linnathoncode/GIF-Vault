/**
 * Media resolver composition root.
 * Normalizes/expands URLs, classifies source type, and dispatches to
 * resolver strategies to produce concrete media URL candidates.
 */
import { UI_MESSAGES } from "../lib/messages.js";
import { RESOLVER_KINDS, classifyResolverInput } from "./media-resolver/classifier.js";
import {
  expandUrl,
  resolveDirectMediaUrls,
  resolveHtmlEmbedUrls,
  resolveTwitterPostUrls,
} from "./media-resolver/strategies.js";
import {
  extractTweetId,
  isSupportedMediaType,
  isTwitterUrl,
  looksDirectMedia,
} from "./media-resolver/shared.js";

async function resolveMediaUrl(rawUrl) {
  const urls = await resolveMediaUrls(rawUrl);
  return urls[0] || String(rawUrl || "");
}

async function resolveMediaUrls(rawUrl) {
  const inputUrl = String(rawUrl || "").trim();
  if (!inputUrl) {
    return [];
  }

  if (looksDirectMedia(inputUrl)) {
    return resolveDirectMediaUrls(inputUrl);
  }

  const directTweetId = extractTweetId(inputUrl);
  const baseUrl = directTweetId ? inputUrl : await expandUrl(inputUrl);
  if (looksDirectMedia(baseUrl)) {
    return resolveDirectMediaUrls(baseUrl);
  }

  const tweetId = directTweetId || extractTweetId(baseUrl);
  const classification = classifyResolverInput({
    rawUrl: inputUrl,
    baseUrl,
    tweetId,
  });

  if (classification === RESOLVER_KINDS.twitterPost) {
    const urls = await resolveTwitterPostUrls(tweetId, baseUrl);
    return urls.length > 0 ? urls : [baseUrl];
  }

  if (classification === RESOLVER_KINDS.htmlEmbed) {
    const urls = await resolveHtmlEmbedUrls(baseUrl);
    return urls.length > 0 ? urls : [baseUrl];
  }

  return [baseUrl];
}

function getReadableImportError(url, contentType) {
  const normalizedType = (contentType || "").toLowerCase();
  if (normalizedType.startsWith("text/html")) {
    return UI_MESSAGES.popup.enterValidUrl;
  }
  if (isTwitterUrl(url)) {
    return UI_MESSAGES.import.couldNotResolveMediaFromPost;
  }
  return UI_MESSAGES.import.resolvedUrlNotMedia(contentType);
}

export {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
  resolveMediaUrls,
};
