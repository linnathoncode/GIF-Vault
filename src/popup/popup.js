import {
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbSave,
  idbDelete,
  idbClear,
} from "../lib/db.js";
import { fileExtensionFromMime } from "../lib/media.js";
import { STORAGE_KEYS, ICONS, POPUP_MENU } from "../lib/settings.js";
import { safeLog } from "../lib/log.js";
import { formatBytes, hostFromUrl, originPatternFromUrl } from "../lib/ui.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setThemeToggleGlyph,
  setToolbarIcon,
} from "../lib/theme.js";

const grid = document.getElementById("grid");
const countEl = document.getElementById("count");
const importInput = document.getElementById("importInput");
const searchInput = document.getElementById("searchInput");
const importBtn = document.getElementById("importBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const statusEl = document.getElementById("status");
const progressTrackEl = document.getElementById("progressTrack");
const progressBarEl = document.getElementById("progressBar");
const progressLabelEl = document.getElementById("progressLabel");
const openLogsBtn = document.getElementById("openLogsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const tabAllBtn = document.getElementById("tabAllBtn");
const tabFavoritesBtn = document.getElementById("tabFavoritesBtn");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageIndicator = document.getElementById("pageIndicator");
const brandLogo = document.getElementById("brandLogo");

const objectUrlById = new Map();
let currentTab = "all";
let currentPage = 1;
let searchTerm = "";
let themeMode = "light";
let activeImportRequestId = "";
let renderSequence = 0;

function getImportProgressPercent(state) {
  if (!state?.text) {
    return 0;
  }
  if (state.kind === "success") {
    return 100;
  }

  const text = state.text.toLowerCase();
  if (text.includes("saving")) {
    return 88;
  }
  if (text.includes("converting")) {
    return 66;
  }
  if (text.includes("fetching")) {
    return 40;
  }
  if (text.includes("resolving")) {
    return 16;
  }
  return state.active ? 12 : 100;
}

function setProgressState(state) {
  if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
    return;
  }

  const percent = getImportProgressPercent(state);
  const kind = state?.kind || "";
  const isVisible = Boolean(
    state?.active || kind === "success" || kind === "error",
  );
  progressTrackEl.classList.toggle("active", isVisible);
  progressTrackEl.classList.toggle("ok", kind === "success");
  progressTrackEl.classList.toggle("error", kind === "error");
  progressBarEl.style.width = `${percent}%`;
  progressLabelEl.textContent = state?.text || "";
}

function setStatus(text, kind = "") {
  if (progressLabelEl) {
    progressLabelEl.textContent = text;
  }
  let normalizedKind = "";
  if (kind === true) {
    normalizedKind = "ok";
  } else if (kind === false || kind == null) {
    normalizedKind = "";
  } else {
    normalizedKind = String(kind);
  }
  statusEl.className = normalizedKind ? `status ${normalizedKind}` : "status";
}

function applyImportState(state) {
  if (!state || !state.text) {
    setProgressState(null);
    return;
  }
  const statusKind = state.kind === "success" ? "ok" : state.kind || "";
  setStatus(state.text, statusKind);
  setProgressState(state);
}

function isValidUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildPreviewUrl(item) {
  if (!(item.blob instanceof Blob)) {
    void safeLog("popup", "Skipped preview: blob is invalid", {
      id: item.id,
      mimeType: item.mimeType || "",
      blobType: typeof item.blob,
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
    blobSize: item.blob?.size || 0,
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
  const canWriteBlob =
    navigator.clipboard &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined";

  if (canWriteBlob) {
    try {
      const ext = fileExtensionFromMime(item.mimeType);
      const file = new File([item.blob], `gif-vault-${item.id}.${ext}`, {
        type: item.mimeType || item.blob.type || "application/octet-stream",
      });
      await navigator.clipboard.write([
        new ClipboardItem({ [file.type]: file }),
      ]);
      await safeLog("popup", "Copy succeeded (blob)", {
        id: item.id,
        mimeType: file.type,
      });
      return true;
    } catch (error) {
      await safeLog("popup", "Copy blob failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  const canWriteText =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    try {
      await navigator.clipboard.writeText(
        item.mediaUrl || item.sourceUrl || "",
      );
      await safeLog("popup", "Copy fallback succeeded (url text)", {
        id: item.id,
      });
      return true;
    } catch (error) {
      await safeLog("popup", "Copy url fallback failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
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
    favorite: !Boolean(item.favorite),
  };
  await idbSave(next);
  await safeLog("popup", "Favorite toggled", {
    id: item.id,
    favorite: next.favorite,
  });
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
    name: normalized,
  };
  await idbSave(updated);
  await safeLog("popup", "Item renamed", { id: item.id, name: normalized });
  await render();
}

function createButton({ className, text, title, label, onClick }) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = text;
  if (title) {
    button.title = title;
  }
  if (label) {
    button.setAttribute("aria-label", label);
  }
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

function createInvalidCard(item) {
  const card = document.createElement("article");
  card.className = "item";
  const meta = document.createElement("div");
  meta.className = "meta";

  const urlText = document.createElement("div");
  urlText.className = "url";
  urlText.textContent = "Invalid media entry";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    createButton({
      className: "btn",
      text: "Remove",
      onClick: () => removeItem(item.id),
    }),
  );

  meta.append(urlText, actions);
  card.append(meta);
  return card;
}

function createPreviewMedia(item, previewUrl) {
  const media =
    item.kind === "video"
      ? document.createElement("video")
      : document.createElement("img");
  media.className = "thumb";
  media.src = previewUrl;

  if (item.kind === "video") {
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.addEventListener("error", () => {
      void safeLog("popup", "Video preview failed", {
        id: item.id,
        mimeType: item.mimeType || "",
      });
    });
    return media;
  }

  media.alt = "Saved GIF";
  media.loading = "lazy";
  media.addEventListener("error", () => {
    void safeLog("popup", "Image preview failed", {
      id: item.id,
      mimeType: item.mimeType || "",
    });
  });
  return media;
}

function buildCard(item) {
  const previewUrl = buildPreviewUrl(item);
  if (!previewUrl) {
    return createInvalidCard(item);
  }

  const card = document.createElement("article");
  card.className = "item";
  const media = createPreviewMedia(item, previewUrl);

  const meta = document.createElement("div");
  meta.className = "meta";

  const nameRow = document.createElement("div");
  nameRow.className = "name-row";

  const nameText = document.createElement("div");
  nameText.className = "name";
  nameText.textContent =
    item.name && item.name.trim() ? item.name.trim() : "Untitled";

  const renameBtn = createButton({
    className: "name-btn",
    text: "\u270E",
    title: "Rename",
    label: "Rename",
    onClick: () => renameItem(item),
  });

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

  const copyBtn = createButton({
    className: "btn primary",
    text: "\u29C9",
    title: "Copy",
    label: "Copy",
  });
  copyBtn.addEventListener("click", async () => {
    const ok = await copyItemBlob(item);
    copyBtn.textContent = ok ? "\u2713" : "!";
    setTimeout(() => {
      copyBtn.textContent = "\u29C9";
    }, POPUP_MENU.copyFeedbackResetDelayMs);
  });

  const favoriteBtn = createButton({
    className: "btn",
    text: item.favorite ? "\u2605" : "\u2606",
    title: item.favorite ? "Unfavorite" : "Favorite",
    label: item.favorite ? "Unfavorite" : "Favorite",
    onClick: () => toggleFavorite(item),
  });
  if (item.favorite) {
    favoriteBtn.classList.add("favorite-active");
  }

  const removeBtn = createButton({
    className: "btn danger",
    text: "\u2715",
    title: "Delete",
    label: "Delete",
    onClick: () => removeItem(item.id),
  });

  actions.append(copyBtn, favoriteBtn, removeBtn);
  meta.append(nameRow, urlText, sizeText, actions);
  card.append(media, meta);
  return card;
}

async function render() {
  const renderId = ++renderSequence;
  const items = await idbGetAllMedia();
  if (renderId !== renderSequence) {
    return;
  }
  const normalized = items.map((item) => ({
    ...item,
    favorite: Boolean(item.favorite),
    name: item.name || "",
  }));
  const byTab =
    currentTab === "favorites"
      ? normalized.filter((item) => item.favorite)
      : normalized;
  const query = searchTerm.trim().toLowerCase();
  const visibleItems = query
    ? byTab.filter((item) => {
        const haystack =
          `${item.name || ""} ${item.sourceUrl || ""} ${item.mediaUrl || ""}`.toLowerCase();
        return haystack.includes(query);
      })
    : byTab;
  const totalPages = Math.max(
    1,
    Math.ceil(visibleItems.length / POPUP_MENU.pageSize),
  );
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * POPUP_MENU.pageSize;
  const pagedItemsMeta = visibleItems.slice(
    startIndex,
    startIndex + POPUP_MENU.pageSize,
  );

  await safeLog("popup", "Render media grid", {
    count: visibleItems.length,
    tab: currentTab,
  });
  const favoritesCount = normalized.filter((item) => item.favorite).length;
  countEl.textContent =
    currentTab === "favorites"
      ? `${visibleItems.length} favorite(s)`
      : `${normalized.length} saved | ${favoritesCount} favorite(s)`;

  tabAllBtn.classList.toggle("active", currentTab === "all");
  tabFavoritesBtn.classList.toggle("active", currentTab === "favorites");
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;

  pruneObjectUrlsForVisibleIds(new Set(pagedItemsMeta.map((item) => item.id)));

  grid.innerHTML = "";
  if (pagedItemsMeta.length === 0) {
    if (renderId !== renderSequence) {
      return;
    }
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

  const blobById = await idbGetMediaBlobs(pagedItemsMeta.map((item) => item.id));
  if (renderId !== renderSequence) {
    return;
  }
  const pagedItems = pagedItemsMeta.map((item) => ({
    ...item,
    blob: blobById.get(item.id) || null,
  }));

  for (const item of pagedItems) {
    try {
      grid.appendChild(buildCard(item));
    } catch (error) {
      await safeLog("popup", "Render item failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }
}

async function importUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) {
    setStatus("Paste a URL first.");
    return;
  }
  if (!isValidUrl(url)) {
    setStatus("Please enter a valid URL.", "error");
    setProgressState({
      text: "Please enter a valid URL.",
      kind: "error",
      active: false,
    });
    return;
  }

  const requestId = crypto.randomUUID();
  activeImportRequestId = requestId;
  setStatus("Starting import...");
  setProgressState({
    text: "Starting import...",
    kind: "info",
    active: true,
  });
  await safeLog("popup", "Import requested from popup", { url });

  try {
    const missingOrigins = await findMissingOrigins(
      new Set([originPatternFromUrl(url)]),
    );
    if (missingOrigins.length > 0) {
      await openPermissionAssist(url, "", missingOrigins);
      setStatus(
        `Additional site access is needed. Continue in the permission tab.`,
      );
      setProgressState(null);
      activeImportRequestId = "";
      return;
    }
  } catch (error) {
    setStatus(error?.message || "Import failed");
    setProgressState({
      text: error?.message || "Import failed",
      kind: "error",
      active: false,
    });
    activeImportRequestId = "";
    await safeLog("popup", "Import failed in popup", {
      error: error?.message || "unknown",
    });
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_URL",
      url,
      requestId,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Import failed");
    }

    importInput.value = "";
    importBtn.textContent = "Import";
    const convertedMessage = response.result?.converted ? " (converted)" : "";
    setStatus(`Imported successfully${convertedMessage}.`, true);
    setProgressState({
      text: `Imported successfully${convertedMessage}.`,
      kind: "success",
      active: false,
    });
    activeImportRequestId = "";
    await render();
  } catch (error) {
    if (String(error?.message || "").startsWith("Host access needed for ")) {
      await openPermissionAssist(url, "", []);
      setStatus(
        `Additional site access is needed. Continue in the permission tab.`,
      );
      setProgressState(null);
      activeImportRequestId = "";
      return;
    }
    setStatus(error?.message || "Import failed");
    setProgressState({
      text: error?.message || "Import failed",
      kind: "error",
      active: false,
    });
    activeImportRequestId = "";
    await safeLog("popup", "Import failed in popup", {
      error: error?.message || "unknown",
    });
  }
}

async function findMissingOrigins(origins) {
  const missing = [];
  for (const origin of origins) {
    if (!origin) {
      continue;
    }
    const hasAccess = await chrome.permissions.contains({
      origins: [origin],
    });
    if (!hasAccess) {
      missing.push(origin);
    }
  }
  return missing;
}

async function openPermissionAssist(url, pageUrl, missingOrigins) {
  const assistUrl = new URL(
    chrome.runtime.getURL("assist/permission-assist.html"),
  );
  assistUrl.searchParams.set("url", url || "");
  if (pageUrl) {
    assistUrl.searchParams.set("pageUrl", pageUrl);
  }
  if (Array.isArray(missingOrigins) && missingOrigins.length > 0) {
    assistUrl.searchParams.set("origins", JSON.stringify(missingOrigins));
  }
  await chrome.tabs.create({ url: assistUrl.toString() });
}

function applyImportAssistFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const importUrl = params.get("importUrl") || "";
  const status = params.get("status") || "";
  if (importUrl && !importInput.value) {
    importInput.value = importUrl;
  }
  if (status) {
    setStatus(status);
  }
}

importBtn.addEventListener("click", () => importUrl(importInput.value));
importInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    importUrl(importInput.value);
  }
});

clearAllBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all items from GIF Vault? This cannot be undone.",
  );
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
  await setThemeMode(themeMode);
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

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  setThemeToggleGlyph(themeToggleBtn, theme);
  void setToolbarIcon(theme);
  if (brandLogo) {
    const oppositeTheme = theme === "dark" ? "light" : "dark";
    brandLogo.src = `../${ICONS[oppositeTheme]["128"]}`;
  }
  themeMode = theme;
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
  } else {
    setProgressState(null);
  }
  if ((prevState?.active || false) && !nextState?.active) {
    void render();
  }
});

async function init() {
  applyTheme(await getThemeMode());
  applyImportAssistFromQuery();
  const importState = await getImportState();
  if (importState?.active) {
    applyImportState(importState);
  }
  await render();
}

init();
