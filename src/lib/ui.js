function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl || "";
  }
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

function formatBytes(bytes, units = ["B", "KB", "MB", "GB"]) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export { hostFromUrl, originPatternFromUrl, formatBytes };
