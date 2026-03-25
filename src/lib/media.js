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

function getWebpAnimationState(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array();

  if (bytes.length < 12) {
    return "indeterminate";
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

  const readUint32LE = (offset) => (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;

  if (!asciiAt(0, "RIFF") || !asciiAt(8, "WEBP")) {
    return "not-animated";
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const chunkSize = readUint32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;
    if (chunkDataEnd > bytes.length) {
      return "indeterminate";
    }

    if (chunkId === "ANIM") {
      return "animated";
    }

    if (chunkId === "VP8X" && chunkSize >= 1) {
      const featureFlags = bytes[chunkDataStart];
      if ((featureFlags & 0x02) !== 0) {
        return "animated";
      }
    }

    offset = chunkDataEnd + (chunkSize % 2);
  }

  return "not-animated";
}

function isAnimatedWebpBytes(value) {
  return getWebpAnimationState(value) === "animated";
}

export {
  extensionFromUrl,
  fileExtensionFromMime,
  getWebpAnimationState,
  isAnimatedWebpBytes,
};
