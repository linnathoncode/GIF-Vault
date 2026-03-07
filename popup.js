import { idbGetAll, idbSave, idbDelete, idbClear, idbLog } from "./db.js";

const grid = document.getElementById("grid");
const countEl = document.getElementById("count");
const importInput = document.getElementById("importInput");
const importBtn = document.getElementById("importBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const statusEl = document.getElementById("status");
const openLogsBtn = document.getElementById("openLogsBtn");
const tabAllBtn = document.getElementById("tabAllBtn");
const tabFavoritesBtn = document.getElementById("tabFavoritesBtn");

const objectUrlById = new Map();
let currentTab = "all";

function setStatus(text, isOk = false) {
  statusEl.textContent = text;
  statusEl.className = isOk ? "status ok" : "status";
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl || "";
  }
}

function fileExtensionFromMime(mimeType) {
  if (!mimeType) {
    return "bin";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  if (mimeType.includes("webm")) {
    return "webm";
  }
  if (mimeType.includes("png")) {
    return "png";
  }
  if (mimeType.includes("jpeg")) {
    return "jpg";
  }
  return "bin";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function buildPreviewUrl(item) {
  if (!(item.blob instanceof Blob)) {
    void safeLog("popup", "Skipped preview: blob is invalid", {
      id: item.id,
      mimeType: item.mimeType || "",
      blobType: typeof item.blob
    });
    return "";
  }

  const existing = objectUrlById.get(item.id);
  if (existing) {
    return existing;
  }

  const objectUrl = URL.createObjectURL(item.blob);
  objectUrlById.set(item.id, objectUrl);
  void safeLog("popup", "Created object URL for preview", {
    id: item.id,
    mimeType: item.mimeType || "",
    blobSize: item.blob?.size || 0
  });
  return objectUrl;
}

function cleanupObjectUrls() {
  for (const url of objectUrlById.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlById.clear();
}

async function copyItemBlob(item) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" || typeof ClipboardItem === "undefined") {
    return false;
  }

  try {
    const ext = fileExtensionFromMime(item.mimeType);
    const file = new File([item.blob], `gif-vault-${item.id}.${ext}`, {
      type: item.mimeType || item.blob.type || "application/octet-stream"
    });

    await navigator.clipboard.write([
      new ClipboardItem({ [file.type]: file })
    ]);
    return true;
  } catch {
    return false;
  }
}

async function removeItem(id) {
  await idbDelete(id);
  const objectUrl = objectUrlById.get(id);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrlById.delete(id);
  }
  await render();
}

async function toggleFavorite(item) {
  const next = {
    ...item,
    favorite: !Boolean(item.favorite)
  };
  await idbSave(next);
  await safeLog("popup", "Favorite toggled", { id: item.id, favorite: next.favorite });
  await render();
}

function buildCard(item) {
  const card = document.createElement("article");
  card.className = "item";

  const previewUrl = buildPreviewUrl(item);
  if (!previewUrl) {
    const card = document.createElement("article");
    card.className = "item";
    const meta = document.createElement("div");
    meta.className = "meta";
    const urlText = document.createElement("div");
    urlText.className = "url";
    urlText.textContent = "Invalid media entry";
    const actions = document.createElement("div");
    actions.className = "actions";
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeItem(item.id));
    actions.append(removeBtn);
    meta.append(urlText, actions);
    card.append(meta);
    return card;
  }

  const media = item.kind === "video" ? document.createElement("video") : document.createElement("img");
  media.className = "thumb";
  if (item.kind === "video") {
    media.src = previewUrl;
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.addEventListener("error", () => {
      void safeLog("popup", "Video preview failed", { id: item.id, mimeType: item.mimeType || "" });
    });
  } else {
    media.src = previewUrl;
    media.alt = "Saved GIF";
    media.loading = "lazy";
    media.addEventListener("error", () => {
      void safeLog("popup", "Image preview failed", { id: item.id, mimeType: item.mimeType || "" });
    });
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const urlText = document.createElement("div");
  urlText.className = "url";
  const sizeLabel = formatBytes(item.blob?.size || 0);
  const favPrefix = item.favorite ? "* " : "";
  urlText.textContent = `${favPrefix}${hostFromUrl(item.sourceUrl || item.mediaUrl || "")}`;

  const sizeText = document.createElement("div");
  sizeText.className = "size";
  sizeText.textContent = `Size: ${sizeLabel}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn primary";
  copyBtn.type = "button";
  copyBtn.textContent = "⧉";
  copyBtn.title = "Copy";
  copyBtn.setAttribute("aria-label", "Copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyItemBlob(item);
    copyBtn.textContent = ok ? "✓" : "!";
    setTimeout(() => {
      copyBtn.textContent = "⧉";
    }, 900);
  });

  const favoriteBtn = document.createElement("button");
  favoriteBtn.className = "btn";
  favoriteBtn.type = "button";
  favoriteBtn.textContent = item.favorite ? "★" : "☆";
  favoriteBtn.title = item.favorite ? "Unfavorite" : "Favorite";
  favoriteBtn.setAttribute("aria-label", item.favorite ? "Unfavorite" : "Favorite");
  favoriteBtn.addEventListener("click", () => toggleFavorite(item));

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn danger";
  removeBtn.type = "button";
  removeBtn.textContent = "✕";
  removeBtn.title = "Delete";
  removeBtn.setAttribute("aria-label", "Delete");
  removeBtn.addEventListener("click", () => removeItem(item.id));

  actions.append(copyBtn, favoriteBtn, removeBtn);
  meta.append(urlText, sizeText, actions);
  card.append(media, meta);
  return card;
}

async function render() {
  const items = await idbGetAll();
  const normalized = items.map((item) => ({ ...item, favorite: Boolean(item.favorite) }));
  const visibleItems = currentTab === "favorites"
    ? normalized.filter((item) => item.favorite)
    : normalized;

  await safeLog("popup", "Render media grid", { count: visibleItems.length, tab: currentTab });
  const favoritesCount = normalized.filter((item) => item.favorite).length;
  countEl.textContent = currentTab === "favorites"
    ? `${visibleItems.length} favorite(s)`
    : `${normalized.length} saved | ${favoritesCount} favorite(s)`;

  tabAllBtn.classList.toggle("active", currentTab === "all");
  tabFavoritesBtn.classList.toggle("active", currentTab === "favorites");

  grid.innerHTML = "";
  if (visibleItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = currentTab === "favorites"
      ? "No favorites yet. Mark items as Favorite from the All tab."
      : "Paste a URL above to import into GIF Vault.";
    grid.appendChild(empty);
    return;
  }

  for (const item of visibleItems) {
    try {
      grid.appendChild(buildCard(item));
    } catch (error) {
      await safeLog("popup", "Render item failed", { id: item.id, error: error?.message || "unknown" });
    }
  }
}

async function importUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) {
    setStatus("Paste a URL first.");
    return;
  }

  setStatus("Importing...");
  await safeLog("popup", "Import requested from popup", { url });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_URL",
      url
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import failed");
    }

    importInput.value = "";
    const convertedMessage = response.result?.converted ? " (converted)" : "";
    setStatus(`Imported successfully${convertedMessage}.`, true);
    await render();
  } catch (error) {
    setStatus(error?.message || "Import failed");
    await safeLog("popup", "Import failed in popup", { error: error?.message || "unknown" });
  }
}

importBtn.addEventListener("click", () => importUrl(importInput.value));
importInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    importUrl(importInput.value);
  }
});

clearAllBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("Clear all items from GIF Vault? This cannot be undone.");
  if (!confirmed) {
    return;
  }
  await idbClear();
  cleanupObjectUrls();
  setStatus("Vault cleared.", true);
  await safeLog("popup", "Vault cleared");
  await render();
});

window.addEventListener("unload", cleanupObjectUrls);
openLogsBtn.addEventListener("click", () => {
  const url = chrome.runtime.getURL("logs.html");
  void chrome.tabs.create({ url });
});
tabAllBtn.addEventListener("click", async () => {
  currentTab = "all";
  await render();
});
tabFavoritesBtn.addEventListener("click", async () => {
  currentTab = "favorites";
  await render();
});

async function safeLog(stage, message, details = {}) {
  try {
    await idbLog(stage, message, details);
  } catch {
    // no-op
  }
}

render();
