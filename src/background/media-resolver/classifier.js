/**
 * Classifies incoming resolver inputs so URL handling can dispatch
 * to a focused strategy module.
 */
import { isTwitterUrl, looksDirectMedia } from "./shared.js";

const RESOLVER_KINDS = Object.freeze({
  directMedia: "direct_media",
  twitterPost: "twitter_post",
  htmlEmbed: "html_embed_candidate",
  unsupported: "unsupported",
});

function classifyResolverInput({ rawUrl = "", baseUrl = "", tweetId = "" } = {}) {
  const candidate = String(baseUrl || rawUrl || "").trim();
  if (!candidate) {
    return RESOLVER_KINDS.unsupported;
  }

  if (looksDirectMedia(candidate)) {
    return RESOLVER_KINDS.directMedia;
  }

  if (tweetId && isTwitterUrl(candidate)) {
    return RESOLVER_KINDS.twitterPost;
  }

  try {
    const protocol = new URL(candidate).protocol;
    if (protocol === "http:" || protocol === "https:") {
      return RESOLVER_KINDS.htmlEmbed;
    }
  } catch {
    return RESOLVER_KINDS.unsupported;
  }

  return RESOLVER_KINDS.unsupported;
}

export { RESOLVER_KINDS, classifyResolverInput };
