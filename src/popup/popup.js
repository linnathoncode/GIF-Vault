import { idbGetAll, idbSave, idbDelete, idbClear, idbLog } from "../lib/db.js";
import { fileExtensionFromMime } from "../lib/media.js";
import { STORAGE_KEYS, ICONS } from "../lib/settings.js";

const grid = document.getElementById("grid");
const countEl = document.getElementById("count");
const importInput = document.getElementById("importInput");
const searchInput = document.getElementById("searchInput");
const importBtn = document.getElementById("importBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const statusEl = document.getElementById("status");
const openLogsBtn = document.getElementById("openLogsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const tabAllBtn = document.getElementById("tabAllBtn");
const tabFavoritesBtn = document.getElementById("tabFavoritesBtn");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageIndicator = document.getElementById("pageIndicator");
const brandLogo = document.getElementById("brandLogo");

const objectUrlById = new Map();
const PAGE_SIZE = 18;
let currentTab = "all";
let currentPage = 1;
let searchTerm = "";
let themeMode = "light";
let activeImportRequestId = "";

function setStatus(text, isOk = false) {
  statusEl.textContent = text;
  statusEl.className = isOk ? "status ok" : "status";
}

function applyImportState(state) {
  if (!state || !state.text) {
    return;
  }
  const isOk = state.kind === "success";
  setStatus(state.text, isOk);
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl || "";
  }
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

function pruneObjectUrlsForVisibleIds(visibleIds) {
  for (const [id, url] of objectUrlById.entries()) {
    if (visibleIds.has(id)) {
      continue;
    }
    URL.revokeObjectURL(url);
    objectUrlById.delete(id);
  }
}

async function copyItemBlob(item) {
  const canWriteBlob = navigator.clipboard
    && typeof navigator.clipboard.write === "function"
    && typeof ClipboardItem !== "undefined";

  if (canWriteBlob) {
    try {
      const ext = fileExtensionFromMime(item.mimeType);
      const file = new File([item.blob], `gif-vault-${item.id}.${ext}`, {
        type: item.mimeType || item.blob.type || "application/octet-stream"
      });
      await navigator.clipboard.write([
        new ClipboardItem({ [file.type]: file })
      ]);
      await safeLog("popup", "Copy succeeded (blob)", { id: item.id, mimeType: file.type });
      return true;
    } catch (error) {
      await safeLog("popup", "Copy blob failed", { id: item.id, error: error?.message || "unknown" });
    }
  }

  const canWriteText = navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    try {
      await navigator.clipboard.writeText(item.mediaUrl || item.sourceUrl || "");
      await safeLog("popup", "Copy fallback succeeded (url text)", { id: item.id });
      return true;
    } catch (error) {
      await safeLog("popup", "Copy url fallback failed", { id: item.id, error: error?.message || "unknown" });
    }
  }

  return false;
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

async function renameItem(item) {
  const currentName = item.name || "";
  const nextName = window.prompt("Name this GIF:", currentName);
  if (nextName === null) {
    return;
  }
  const normalized = nextName.trim();
  const updated = {
    ...item,
    name: normalized
  };
  await idbSave(updated);
  await safeLog("popup", "Item renamed", { id: item.id, name: normalized });
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

  const nameRow = document.createElement("div");
  nameRow.className = "name-row";

  const nameText = document.createElement("div");
  nameText.className = "name";
  nameText.textContent = item.name && item.name.trim() ? item.name.trim() : "Untitled";

  const renameBtn = document.createElement("button");
  renameBtn.className = "name-btn";
  renameBtn.type = "button";
  renameBtn.textContent = "\u270E";
  renameBtn.title = "Rename";
  renameBtn.setAttribute("aria-label", "Rename");
  renameBtn.addEventListener("click", () => renameItem(item));

  nameRow.append(nameText, renameBtn);

  const urlText = document.createElement("div");
  urlText.className = "url";
  const sizeLabel = formatBytes(item.blob?.size || 0);
  urlText.textContent = hostFromUrl(item.sourceUrl || item.mediaUrl || "");

  const sizeText = document.createElement("div");
  sizeText.className = "size";
  sizeText.textContent = `Size: ${sizeLabel}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn primary";
  copyBtn.type = "button";
  copyBtn.textContent = "\u29C9";
  copyBtn.title = "Copy";
  copyBtn.setAttribute("aria-label", "Copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyItemBlob(item);
    copyBtn.textContent = ok ? "\u2713" : "!";
    setTimeout(() => {
      copyBtn.textContent = "\u29C9";
    }, 900);
  });

  const favoriteBtn = document.createElement("button");
  favoriteBtn.className = "btn";
  if (item.favorite) {
    favoriteBtn.classList.add("favorite-active");
  }
  favoriteBtn.type = "button";
  favoriteBtn.textContent = item.favorite ? "\u2605" : "\u2606";
  favoriteBtn.title = item.favorite ? "Unfavorite" : "Favorite";
  favoriteBtn.setAttribute("aria-label", item.favorite ? "Unfavorite" : "Favorite");
  favoriteBtn.addEventListener("click", () => toggleFavorite(item));

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn danger";
  removeBtn.type = "button";
  removeBtn.textContent = "\u2715";
  removeBtn.title = "Delete";
  removeBtn.setAttribute("aria-label", "Delete");
  removeBtn.addEventListener("click", () => removeItem(item.id));

  actions.append(copyBtn, favoriteBtn, removeBtn);
  meta.append(nameRow, urlText, sizeText, actions);
  card.append(media, meta);
  return card;
}

async function render() {
  const items = await idbGetAll();
  const normalized = items.map((item) => ({ ...item, favorite: Boolean(item.favorite), name: item.name || "" }));
  const byTab = currentTab === "favorites"
    ? normalized.filter((item) => item.favorite)
    : normalized;
  const query = searchTerm.trim().toLowerCase();
  const visibleItems = query
    ? byTab.filter((item) => {
      const haystack = `${item.name || ""} ${item.sourceUrl || ""} ${item.mediaUrl || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    : byTab;
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pagedItems = visibleItems.slice(startIndex, startIndex + PAGE_SIZE);

  await safeLog("popup", "Render media grid", { count: visibleItems.length, tab: currentTab });
  const favoritesCount = normalized.filter((item) => item.favorite).length;
  countEl.textContent = currentTab === "favorites"
    ? `${visibleItems.length} favorite(s)`
    : `${normalized.length} saved | ${favoritesCount} favorite(s)`;

  tabAllBtn.classList.toggle("active", currentTab === "all");
  tabFavoritesBtn.classList.toggle("active", currentTab === "favorites");
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;

  pruneObjectUrlsForVisibleIds(new Set(pagedItems.map((item) => item.id)));

  grid.innerHTML = "";
  if (pagedItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query
      ? "No matches for your search."
      : currentTab === "favorites"
      ? "No favorites yet. Mark items as Favorite from the All tab."
      : "Paste a URL above to import into GIF Vault.";
    grid.appendChild(empty);
    return;
  }

  for (const item of pagedItems) {
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

  const requestId = crypto.randomUUID();
  activeImportRequestId = requestId;
  setStatus("Starting import...");
  await safeLog("popup", "Import requested from popup", { url });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_URL",
      url,
      requestId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import failed");
    }

    importInput.value = "";
    const convertedMessage = response.result?.converted ? " (converted)" : "";
    setStatus(`Imported successfully${convertedMessage}.`, true);
    activeImportRequestId = "";
    await render();
  } catch (error) {
    setStatus(error?.message || "Import failed");
    activeImportRequestId = "";
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
  const url = chrome.runtime.getURL("logs/logs.html");
  void chrome.tabs.create({ url });
});
themeToggleBtn.addEventListener("click", async () => {
  themeMode = themeMode === "dark" ? "light" : "dark";
  applyTheme(themeMode);
  await setTheme(themeMode);
});
tabAllBtn.addEventListener("click", async () => {
  currentTab = "all";
  currentPage = 1;
  await render();
});
tabFavoritesBtn.addEventListener("click", async () => {
  currentTab = "favorites";
  currentPage = 1;
  await render();
});
searchInput.addEventListener("input", async () => {
  searchTerm = searchInput.value || "";
  currentPage = 1;
  await render();
});
prevPageBtn.addEventListener("click", async () => {
  currentPage = Math.max(1, currentPage - 1);
  await render();
});
nextPageBtn.addEventListener("click", async () => {
  currentPage += 1;
  await render();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message) {
    return;
  }
  if (message.type === "VAULT_UPDATED") {
    void render();
    return;
  }
  if (message.type !== "IMPORT_PROGRESS") {
    return;
  }
  if (activeImportRequestId && message.requestId !== activeImportRequestId) {
    return;
  }
  applyImportState(message);
});

async function safeLog(stage, message, details = {}) {
  try {
    await idbLog(stage, message, details);
  } catch {
    // no-op
  }
}

function applyTheme(mode) {
  const theme = mode === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "\u2600" : "\u263E";
  void setToolbarIcon(theme);
  if (brandLogo) {
    const oppositeTheme = theme === "dark" ? "light" : "dark";
    brandLogo.src = `../${ICONS[oppositeTheme]["128"]}`;
  }
  themeMode = theme;
}

async function setToolbarIcon(theme) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "SET_THEME_ICON", theme });
    if (response?.ok) {
      return;
    }
  } catch {
    // fallback below
  }

  const paths = ICONS[theme === "dark" ? "dark" : "light"];
  await new Promise((resolve) => {
    chrome.action.setIcon(
      {
        path: {
          16: paths["16"],
          32: paths["32"],
          48: paths["48"]
        }
      },
      () => resolve()
    );
  });
}

function getTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.themeMode], (result) => {
      resolve(result[STORAGE_KEYS.themeMode] === "dark" ? "dark" : "light");
    });
  });
}

function setTheme(theme) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.themeMode]: theme }, resolve);
  });
}

function getImportState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.importState], (result) => {
      resolve(result[STORAGE_KEYS.importState] || null);
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.importState]) {
    return;
  }
  const nextState = changes[STORAGE_KEYS.importState].newValue || null;
  const prevState = changes[STORAGE_KEYS.importState].oldValue || null;
  if (nextState) {
    applyImportState(nextState);
  }
  if ((prevState?.active || false) && !nextState?.active) {
    void render();
  }
});

async function init() {
  applyTheme(await getTheme());
  const importState = await getImportState();
  if (importState?.active) {
    applyImportState(importState);
  }
  await render();
}

init();

