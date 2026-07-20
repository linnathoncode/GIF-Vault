// Bulk import input helpers. Parses URL-list text independently from the
// transfer page so validation and deduplication stay deterministic.

function parseUrlList(text) {
  const urls = [];
  const invalid = [];
  const seen = new Set();

  // Treat a comma as a separator only when another HTTP(S) URL follows it.
  // Commas inside URL paths and query values remain untouched.
  const entries = String(text || "").split(/\r?\n|,\s*(?=https?:\/\/)/i);
  for (const rawLine of entries) {
    const candidate = rawLine.trim();
    if (!candidate || candidate.startsWith("#")) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      const normalized = url.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      invalid.push(candidate);
    }
  }

  return { urls, invalid };
}

function mergeUrlLists(...lists) {
  const urls = [];
  const seen = new Set();
  for (const list of lists) {
    for (const rawUrl of list || []) {
      const url = String(rawUrl || "").trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

function originPatternsForUrls(urls) {
  return [...new Set((urls || []).map((url) => {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/*`;
  }))];
}

export { mergeUrlLists, originPatternsForUrls, parseUrlList };
