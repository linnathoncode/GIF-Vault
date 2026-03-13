import {
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbSave,
  idbDelete,
  idbClear,
} from "../lib/db.js";
import { fileExtensionFromMime } from "../lib/media.js";
import { STORAGE_KEYS, ICONS, POPUP_MENU } from "../lib/settings.js";
import {
  getRuntimeConfig,
  normalizeRuntimeConfig,
} from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import {
  formatBytes,
  hostFromUrl,
  isValidUrl,
  originPatternFromUrl,
} from "../lib/ui.js";
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
const openSettingsBtn = document.getElementById("openSettingsBtn");
const openLogsBtn = document.getElementById("openLogsBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const tabAllBtn = document.getElementById("tabAllBtn");
const tabFavoritesBtn = document.getElementById("tabFavoritesBtn");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageIndicator = document.getElementById("pageIndicator");
const brandLogo = document.getElementById("brandLogo");
const hoverPreviewEl = document.getElementById("hoverPreview");
const hoverPreviewImgEl = document.getElementById("hoverPreviewImg");

const objectUrlById = new Map();
let currentTab = POPUP_MENU.defaultTab;
let currentPage = 1;
let searchTerm = "";
let themeMode = "light";
let activeImportRequestId = "";
let renderSequence = 0;
let pendingFocusRestore = null;
let hoverPreviewTimer = 0;
let hoverPreviewSrc = "";
let hoverPointerX = 0;
let hoverPointerY = 0;
let armedDeleteItemId = "";
let armedDeleteTimer = 0;
let armedDeleteButton = null;
let currentImportState = null;
let transientStatusTimer = 0;
let transientStatusActive = false;
let suppressNextStoredImportStateRemoval = false;
let transientProgressSnapshot = null;

function defaultPopupMenuConfig() {
  return {
    pageSize: POPUP_MENU.pageSize,
    defaultTab: POPUP_MENU.defaultTab,
    hoverPreviewEnabled: POPUP_MENU.hoverPreviewEnabled,
    hoverPreviewDelayMs: POPUP_MENU.hoverPreviewDelayMs,
    copyFeedbackResetDelayMs: POPUP_MENU.copyFeedbackResetDelayMs,
    importProgressPercent: {
      ...POPUP_MENU.importProgressPercent,
    },
  };
}

let popupMenuConfig = defaultPopupMenuConfig();

// Import progress and status UI.
function getImportProgressPercent(state) {
  if (!state?.text) {
    return 0;
  }
  if (state.kind === "success") {
    return popupMenuConfig.importProgressPercent.complete;
  }

  const text = state.text.toLowerCase();
  if (text.includes("saving")) {
    return popupMenuConfig.importProgressPercent.saving;
  }
  if (text.includes("converting")) {
    return popupMenuConfig.importProgressPercent.converting;
  }
  if (text.includes("fetching")) {
    return popupMenuConfig.importProgressPercent.fetching;
  }
  if (text.includes("resolving")) {
    return popupMenuConfig.importProgressPercent.resolving;
  }
  return state.active
    ? popupMenuConfig.importProgressPercent.idle
    : popupMenuConfig.importProgressPercent.complete;
}

function setProgressState(state) {
  if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
    return;
  }

  if (!state) {
    clearProgressVisuals();
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

function clearProgressVisuals(options = {}) {
  if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
    return;
  }
  const clearText = options.clearText !== false;
  progressTrackEl.classList.remove("active", "ok", "error");
  progressBarEl.style.width = "0%";
  if (clearText) {
    progressLabelEl.textContent = "";
  }
}

function captureProgressVisuals() {
  if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
    return null;
  }
  return {
    active: progressTrackEl.classList.contains("active"),
    ok: progressTrackEl.classList.contains("ok"),
    error: progressTrackEl.classList.contains("error"),
    width: progressBarEl.style.width || "0%",
    text: progressLabelEl.textContent || "",
  };
}

function restoreProgressVisuals(snapshot) {
  if (!snapshot || !progressTrackEl || !progressBarEl || !progressLabelEl) {
    return;
  }
  progressTrackEl.classList.toggle("active", Boolean(snapshot.active));
  progressTrackEl.classList.toggle("ok", Boolean(snapshot.ok));
  progressTrackEl.classList.toggle("error", Boolean(snapshot.error));
  progressBarEl.style.width = snapshot.width || "0%";
  progressLabelEl.textContent = snapshot.text || "";
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

function clearTransientStatusTimer() {
  if (!transientStatusTimer) {
    return;
  }
  clearTimeout(transientStatusTimer);
  transientStatusTimer = 0;
}

function clearTransientStatus() {
  transientStatusActive = false;
  clearTransientStatusTimer();
  transientProgressSnapshot = null;
}

function showTransientStatus(
  text,
  kind = "",
  durationMs = 2000,
  options = {},
) {
  const preserveProgress =
    options.preserveProgress ?? true;
  transientProgressSnapshot = preserveProgress ? captureProgressVisuals() : null;
  clearTransientStatusTimer();
  transientStatusActive = true;
  setStatus(text, kind);
  transientStatusTimer = setTimeout(() => {
    transientStatusTimer = 0;
    transientStatusActive = false;
    if (currentImportState?.text) {
      transientProgressSnapshot = null;
      applyImportState(currentImportState, { force: true });
      return;
    }
    if (transientProgressSnapshot) {
      restoreProgressVisuals(transientProgressSnapshot);
      transientProgressSnapshot = null;
      return;
    }
    setStatus("");
  }, durationMs);
}

function applyImportState(state, options = {}) {
  currentImportState = state?.text ? state : null;
  if (state?.active) {
    activeImportRequestId = state.requestId || activeImportRequestId;
  } else if (state?.requestId && state.requestId === activeImportRequestId) {
    activeImportRequestId = "";
  }
  if (transientStatusActive && !options.force) {
    return;
  }
  if (!state || !state.text) {
    setProgressState(null);
    return;
  }
  const statusKind = state.kind === "success" ? "ok" : state.kind || "";
  setStatus(state.text, statusKind);
  setProgressState(state);
}

function syncImportActionButton() {
  const isActiveImport = Boolean(currentImportState?.active);
  importBtn.textContent = isActiveImport ? "Terminate" : "Import";
}

async function terminateImport() {
  const requestId = activeImportRequestId || currentImportState?.requestId || "";
  if (!requestId) {
    showTransientStatus("No active import to terminate.", "error");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TERMINATE_IMPORT",
      requestId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Terminate failed");
    }
    showTransientStatus("Import termination requested.", "ok");
  } catch (error) {
    showTransientStatus(error?.message || "Terminate failed.", "error");
  }
}

function setImportErrorState(text) {
  clearTransientStatus();
  currentImportState = null;
  syncImportActionButton();
  setStatus(text, "error");
  setProgressState({
    text,
    kind: "error",
    active: false,
  });
}

function setImportSuccessState(text) {
  clearTransientStatus();
  currentImportState = null;
  syncImportActionButton();
  setStatus(text, "ok");
  setProgressState({
    text,
    kind: "success",
    active: false,
  });
}

function getFilteredItems(items) {
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

  return { normalized, visibleItems, query };
}

function getPagedItemsMeta(items) {
  const totalPages = Math.max(
    1,
    Math.ceil(items.length / popupMenuConfig.pageSize),
  );
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * popupMenuConfig.pageSize;

  return {
    totalPages,
    pagedItemsMeta: items.slice(
      startIndex,
      startIndex + popupMenuConfig.pageSize,
    ),
  };
}

function updatePager(totalPages) {
  tabAllBtn.classList.toggle("active", currentTab === "all");
  tabFavoritesBtn.classList.toggle("active", currentTab === "favorites");
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
}

function setCountText(normalized, visibleItems) {
  const favoritesCount = normalized.filter((item) => item.favorite).length;
  countEl.textContent =
    currentTab === "favorites"
      ? `${visibleItems.length} favorite(s)`
      : `${normalized.length} saved | ${favoritesCount} favorite(s)`;
}

function createEmptyState(query) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = query
    ? "No matches for your search."
    : currentTab === "favorites"
      ? "No favorites yet. Mark items as Favorite from the All tab."
      : "Paste a URL above to import into GIF Vault.";
  return empty;
}

// Preview URL lifecycle for visible media items.
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
  hideHoverPreview();
  clearArmedDelete();
  clearTransientStatus();
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

function clearHoverPreviewTimer() {
  if (!hoverPreviewTimer) {
    return;
  }
  clearTimeout(hoverPreviewTimer);
  hoverPreviewTimer = 0;
}

function positionHoverPreview(x, y) {
  if (!hoverPreviewEl) {
    return;
  }

  const margin = 0;
  const offsetX = 0;
  const offsetY = 0;
  const previewRect = hoverPreviewEl.getBoundingClientRect();
  const maxX = window.innerWidth - previewRect.width - margin;
  const maxY = window.innerHeight - previewRect.height - margin;
  let left = x + offsetX;
  let top = y + offsetY;

  if (left > maxX) {
    left = Math.max(margin, x - previewRect.width - offsetX);
  }
  if (top > maxY) {
    top = Math.max(margin, y - previewRect.height - offsetY);
  }

  hoverPreviewEl.style.left = `${Math.max(margin, left)}px`;
  hoverPreviewEl.style.top = `${Math.max(margin, top)}px`;
}

function hideHoverPreview() {
  clearHoverPreviewTimer();
  if (!hoverPreviewEl || !hoverPreviewImgEl) {
    return;
  }

  hoverPreviewEl.classList.remove("visible");
  hoverPreviewEl.setAttribute("aria-hidden", "true");
  hoverPreviewImgEl.removeAttribute("src");
  hoverPreviewSrc = "";
}

function showHoverPreview(previewUrl) {
  if (!popupMenuConfig.hoverPreviewEnabled) {
    return;
  }
  if (!hoverPreviewEl || !hoverPreviewImgEl || !previewUrl) {
    return;
  }

  if (hoverPreviewSrc !== previewUrl) {
    hoverPreviewImgEl.src = previewUrl;
    hoverPreviewSrc = previewUrl;
  }

  hoverPreviewEl.setAttribute("aria-hidden", "false");
  hoverPreviewEl.classList.add("visible");
  positionHoverPreview(hoverPointerX, hoverPointerY);
}

function updateHoverPointerPosition(event) {
  hoverPointerX = event?.clientX ?? hoverPointerX;
  hoverPointerY = event?.clientY ?? hoverPointerY;
}

function scheduleHoverPreview(previewUrl, event) {
  if (!popupMenuConfig.hoverPreviewEnabled) {
    hideHoverPreview();
    return;
  }
  updateHoverPointerPosition(event);
  clearHoverPreviewTimer();
  hoverPreviewTimer = setTimeout(() => {
    hoverPreviewTimer = 0;
    showHoverPreview(previewUrl);
  }, popupMenuConfig.hoverPreviewDelayMs);
}

function resetDeleteButton(button) {
  if (!(button instanceof HTMLElement)) {
    return;
  }
  button.classList.remove("delete-armed");
  button.textContent = "\u2715";
  button.title = "Delete";
  button.setAttribute("aria-label", "Delete");
}

function clearArmedDelete() {
  if (armedDeleteTimer) {
    clearTimeout(armedDeleteTimer);
    armedDeleteTimer = 0;
  }
  resetDeleteButton(armedDeleteButton);
  armedDeleteItemId = "";
  armedDeleteButton = null;
}

function armDeleteButton(button, itemId) {
  clearArmedDelete();
  armedDeleteItemId = String(itemId);
  armedDeleteButton = button;
  if (button instanceof HTMLElement) {
    button.classList.add("delete-armed");
    button.textContent = "\u2713";
    button.title = "Confirm delete";
    button.setAttribute("aria-label", "Confirm delete");
  }
  showTransientStatus("Click delete again to confirm.", "ok", 2000);
  armedDeleteTimer = setTimeout(() => {
    clearArmedDelete();
  }, 2000);
}

// Item actions that mutate stored media state.
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
      return { ok: true, method: "blob" };
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
    const copiedUrl = item.mediaUrl || item.sourceUrl || "";
    try {
      await navigator.clipboard.writeText(copiedUrl);
      await safeLog("popup", "Copy fallback succeeded (url text)", {
        id: item.id,
      });
      return { ok: true, method: "url", copiedUrl };
    } catch (error) {
      await safeLog("popup", "Copy url fallback failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  return { ok: false, method: "none" };
}

function isVideoLikeUrl(url) {
  return /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(String(url || ""));
}

function setCopyStatus(item, result) {
  if (!result?.ok) {
    showTransientStatus("Copy failed.", "error");
    return;
  }

  if (result.method === "blob") {
    showTransientStatus("Copied GIF.", "ok");
    return;
  }

  const copiedUrl = result.copiedUrl || "";
  const isVideoLink =
    String(item?.mimeType || "").startsWith("video/") || isVideoLikeUrl(copiedUrl);
  const label = isVideoLink ? "Copied video link." : "Copied GIF link.";
  showTransientStatus(
    `${label} Tip: drag and drop the GIF preview to use the GIF directly.`,
    "ok",
  );
}

async function removeItem(id) {
  queueRemovalFocusRestore(id);
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

function queueRemovalFocusRestore(id) {
  const cards = Array.from(grid.querySelectorAll(".item"));
  const currentCard = document.activeElement?.closest(".item");
  const fallbackIndex = cards.findIndex(
    (card) => card.dataset.itemId === String(id),
  );
  const cardIndex = cards.indexOf(currentCard);
  const sourceIndex = cardIndex >= 0 ? cardIndex : fallbackIndex;

  pendingFocusRestore = {
    type: "removal",
    index: sourceIndex >= 0 ? sourceIndex : 0,
  };
}

function focusFirstAvailableAction(card) {
  if (!card) {
    return false;
  }

  const nextTarget = card.querySelector(".btn.danger, .btn, .name-btn");
  if (!(nextTarget instanceof HTMLElement)) {
    return false;
  }

  nextTarget.focus();
  return true;
}

function restorePendingFocus() {
  if (!pendingFocusRestore) {
    return;
  }

  const focusState = pendingFocusRestore;
  pendingFocusRestore = null;

  if (focusState.type !== "removal") {
    return;
  }

  const cards = Array.from(grid.querySelectorAll(".item"));
  if (cards.length === 0) {
    importInput.focus();
    return;
  }

  const targetIndex = Math.min(focusState.index, cards.length - 1);
  if (focusFirstAvailableAction(cards[targetIndex])) {
    return;
  }

  focusFirstAvailableAction(cards[targetIndex - 1] || cards[0]);
}

// Card and media element construction for the grid.
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
  card.dataset.itemId = String(item.id);
  const meta = document.createElement("div");
  meta.className = "meta";

  const urlText = document.createElement("div");
  urlText.className = "url";
  urlText.textContent =
    item.kind === "video"
      ? "Legacy video entry is no longer supported"
      : "Invalid media entry";

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
  const media = document.createElement("img");
  media.className = "thumb";
  media.src = previewUrl;

  media.alt = "Saved GIF";
  media.loading = "lazy";
  media.addEventListener("error", () => {
    void safeLog("popup", "Image preview failed", {
      id: item.id,
      mimeType: item.mimeType || "",
    });
  });
  media.addEventListener("pointerenter", (event) => {
    scheduleHoverPreview(previewUrl, event);
  });
  media.addEventListener("pointermove", (event) => {
    updateHoverPointerPosition(event);
    if (hoverPreviewEl?.classList.contains("visible")) {
      positionHoverPreview(hoverPointerX, hoverPointerY);
    }
  });
  media.addEventListener("pointerleave", hideHoverPreview);
  media.addEventListener("pointercancel", hideHoverPreview);
  return media;
}

function buildCard(item) {
  // Fallback for legacy videos, currently its not possible to import videos
  if (item.kind === "video") {
    return createInvalidCard(item);
  }

  const previewUrl = buildPreviewUrl(item);
  if (!previewUrl) {
    return createInvalidCard(item);
  }

  const card = document.createElement("article");
  card.className = "item";
  card.dataset.itemId = String(item.id);
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
    const result = await copyItemBlob(item);
    copyBtn.textContent = result.ok ? "\u2713" : "!";
    setCopyStatus(item, result);
    setTimeout(() => {
      copyBtn.textContent = "\u29C9";
    }, popupMenuConfig.copyFeedbackResetDelayMs);
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
  });
  removeBtn.addEventListener("click", () => {
    if (armedDeleteItemId === String(item.id)) {
      clearArmedDelete();
      showTransientStatus("GIF deleted.", "ok");
      void removeItem(item.id);
      return;
    }
    armDeleteButton(removeBtn, item.id);
  });

  actions.append(copyBtn, favoriteBtn, removeBtn);
  meta.append(nameRow, urlText, sizeText, actions);
  card.append(media, meta);
  return card;
}

// Grid rendering, filtering, and pagination.
// Because render is an async function renderId and renderSequence is used as a race guard here
async function render() {
  hideHoverPreview();
  clearArmedDelete();
  const renderId = ++renderSequence;
  const items = await idbGetAllMedia();
  if (renderId !== renderSequence) {
    return;
  }
  const { normalized, visibleItems, query } = getFilteredItems(items);
  const { totalPages, pagedItemsMeta } = getPagedItemsMeta(visibleItems);

  await safeLog("popup", "Render media grid", {
    count: visibleItems.length,
    tab: currentTab,
  });
  setCountText(normalized, visibleItems);
  updatePager(totalPages);

  pruneObjectUrlsForVisibleIds(new Set(pagedItemsMeta.map((item) => item.id)));

  grid.innerHTML = "";
  if (pagedItemsMeta.length === 0) {
    if (renderId !== renderSequence) {
      return;
    }
    grid.appendChild(createEmptyState(query));
    restorePendingFocus();
    return;
  }

  const blobById = await idbGetMediaBlobs(
    pagedItemsMeta.map((item) => item.id),
  );
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

  restorePendingFocus();
}

// Import flow and permission handoff.
async function importUrl(rawUrl) {
  clearTransientStatus();
  const url = String(rawUrl || "").trim();
  if (!url) {
    setStatus("Paste a URL first.");
    return;
  }
  if (!isValidUrl(url)) {
    setImportErrorState("Please enter a valid URL.");
    return;
  }

  const requestId = crypto.randomUUID();
  activeImportRequestId = requestId;
  currentImportState = {
    requestId,
    text: "Starting import...",
    kind: "info",
    active: true,
  };
  syncImportActionButton();
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
      currentImportState = null;
      syncImportActionButton();
      return;
    }
  } catch (error) {
    setImportErrorState(error?.message || "Import failed");
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
    setImportSuccessState(`Imported successfully${convertedMessage}.`);
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
      currentImportState = null;
      syncImportActionButton();
      return;
    }
    setImportErrorState(error?.message || "Import failed");
    activeImportRequestId = "";
    await safeLog("popup", "Import failed in popup", {
      error: error?.message || "unknown",
    });
  }
}

// Check host permission for the site origins
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

// Popup bootstrap and event wiring.
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

importBtn.addEventListener("click", () => {
  if (currentImportState?.active) {
    void terminateImport();
    return;
  }
  void importUrl(importInput.value);
});
importInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    importUrl(importInput.value);
  }
});
grid.addEventListener("scroll", hideHoverPreview);
window.addEventListener("blur", hideHoverPreview);

clearAllBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all items from GIF Vault? This cannot be undone.",
  );
  if (!confirmed) {
    return;
  }
  await idbClear();
  cleanupObjectUrls();
  showTransientStatus("Vault cleared.", "ok");
  await safeLog("popup", "Vault cleared");
  await render();
});

window.addEventListener("unload", cleanupObjectUrls);
openSettingsBtn.addEventListener("click", () => {
  if (typeof chrome.runtime.openOptionsPage === "function") {
    void chrome.runtime.openOptionsPage();
    return;
  }
  const url = chrome.runtime.getURL("settings/settings.html");
  void chrome.tabs.create({ url });
});
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
  syncImportActionButton();
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

function clearStoredImportState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.importState], resolve);
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.runtimeConfig]?.newValue) {
    const previousDefaultTab = popupMenuConfig.defaultTab;
    const normalized = normalizeRuntimeConfig(
      changes[STORAGE_KEYS.runtimeConfig].newValue,
    );
    popupMenuConfig = {
      ...normalized.popupMenu,
      importProgressPercent: {
        ...normalized.popupMenu.importProgressPercent,
      },
    };
    if (previousDefaultTab !== popupMenuConfig.defaultTab) {
      currentTab = popupMenuConfig.defaultTab;
      currentPage = 1;
    }
    if (!popupMenuConfig.hoverPreviewEnabled) {
      hideHoverPreview();
    }
    void render();
  }

  if (!changes[STORAGE_KEYS.importState]) {
    return;
  }

  const nextState = changes[STORAGE_KEYS.importState].newValue || null;
  const prevState = changes[STORAGE_KEYS.importState].oldValue || null;
  if (!nextState && suppressNextStoredImportStateRemoval) {
    suppressNextStoredImportStateRemoval = false;
    return;
  }
  if (nextState) {
    applyImportState(nextState);
  } else {
    currentImportState = null;
    if (!transientStatusActive) {
      setProgressState(null);
    }
  }
  syncImportActionButton();
  if ((prevState?.active || false) && !nextState?.active) {
    void render();
  }
});

async function init() {
  const runtimeConfig = await getRuntimeConfig();
  popupMenuConfig = {
    ...runtimeConfig.popupMenu,
    importProgressPercent: {
      ...runtimeConfig.popupMenu.importProgressPercent,
    },
  };
  if (!popupMenuConfig.hoverPreviewEnabled) {
    hideHoverPreview();
  }
  currentTab = popupMenuConfig.defaultTab;
  applyTheme(await getThemeMode());
  applyImportAssistFromQuery();
  const importState = await getImportState();
  if (importState?.text) {
    applyImportState(importState);
    if (!importState.active) {
      suppressNextStoredImportStateRemoval = true;
      await clearStoredImportState();
    }
  } else {
    currentImportState = importState || null;
  }
  syncImportActionButton();
  await render();
}

init();
