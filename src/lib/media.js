function extensionFromUrl(url, mimeType = "") {
  const normalizedMime = String(mimeType || "").toLowerCase();

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) {
      switch (match[1]) {
        case "gif":
          return "gif";
        case "mp4":
          return "mp4";
        case "webm":
          return "webm";
        case "png":
          return "png";
        case "jpg":
        case "jpeg":
          return "jpg";
        default:
          break;
      }
    }
  } catch {
    // Fall back to MIME parsing below.
  }

  return fileExtensionFromMime(normalizedMime);
}

function fileExtensionFromMime(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();

  switch (true) {
    case normalized.includes("image/gif"):
      return "gif";
    case normalized.includes("video/mp4"):
      return "mp4";
    case normalized.includes("video/webm"):
      return "webm";
    case normalized.includes("image/png"):
      return "png";
    case normalized.includes("image/jpeg"):
      return "jpg";
    default:
      return "bin";
  }
}

export { extensionFromUrl, fileExtensionFromMime };
