import {
  idbDelete,
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbSave,
} from "../../lib/db.js";
import { fileExtensionFromMime } from "../../lib/media.js";
import { formatBytes, hostFromUrl } from "../../lib/ui.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";

export function selectionIdsChanged(previousIds, nextIds) {
  const before = [...previousIds].map((id) => String(id)).sort();
  const after = [...nextIds].map((id) => String(id)).sort();
  if (before.length !== after.length) {
    return true;
  }
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) {
      return true;
    }
  }
  return false;
}

export function shouldCancelArmedDeleteOnSelectionChange(
  armedDeleteActionKey,
  previousSelectionIds,
  nextSelectionIds,
) {
  return (
    Boolean(armedDeleteActionKey) &&
    selectionIdsChanged(previousSelectionIds, nextSelectionIds)
  );
}

export function armedDeleteGlyph(count) {
  return count > 1 ? "!" : "\u2713";
}

export function sanitizeCopyFallbackUrl(candidateUrl) {
  const normalized = String(candidateUrl || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return "";
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return "";
  }

  return parsedUrl.toString();
}

function getEmptyMascotVariant({ query = "", currentTab = "all" } = {}) {
  if (String(query || "").trim()) {
    return "search-no-item";
  }
  return currentTab === "favorites" ? "fav-no-item" : "all-no-item";
}

function getEmptyMascotSrc(themeMode, variant) {
  const themePrefix = themeMode === "dark" ? "pesto" : "otha";
  return `../../assets/mascots/${themePrefix}-${variant}.webp`;
}

// Vault filtering, rendering, and item actions.
export function createPopupGridController({
  refs,
  state,
  getPopupMenuConfig,
  showTransientStatus,
}) {
  const TEMP_STATUS_DURATION_MS = 5000;
  const ARMED_DELETE_DURATION_MS = 5000;
  const COPY_HINT_DURATION_MS = 5000;
  const {
    countEl,
    grid,
    hoverPreviewEl,
    hoverPreviewImgEl,
    importInput,
    nextPageBtn,
    pageIndicator,
    prevPageBtn,
    searchInput,
    tabAllBtn,
    tabFavoritesBtn,
  } = refs;

  const objectUrlById = new Map();
  const selectedItemIds = new Set();
  let latestItemById = new Map();
  let latestVisiblePageIds = new Set();
  let hoverPreviewTimer = 0;
  let hoverPreviewSrc = "";
  let hoverPointerX = 0;
  let hoverPointerY = 0;
  let armedDeleteItemId = "";
  let armedDeleteTimer = 0;
  let armedDeleteButtons = [];
  let latestVisibleItemCount = 0;
  let latestSavedItemCount = 0;
  let latestFavoritesCount = 0;

  function getFilteredItems(items) {
    const normalized = items.map((item) => ({
      ...item,
      favorite: Boolean(item.favorite),
      name: item.name || "",
    }));
    const byTab =
      state.currentTab === "favorites"
        ? normalized.filter((item) => item.favorite)
        : normalized;
    const query = state.searchTerm.trim().toLowerCase();
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
    const popupMenuConfig = getPopupMenuConfig();
    const totalPages = Math.max(
      1,
      Math.ceil(items.length / popupMenuConfig.pageSize),
    );
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    const startIndex = (state.currentPage - 1) * popupMenuConfig.pageSize;

    return {
      totalPages,
      pagedItemsMeta: items.slice(startIndex, startIndex + popupMenuConfig.pageSize),
    };
  }

  function updatePager(totalPages) {
    tabAllBtn.classList.toggle("active", state.currentTab === "all");
    tabFavoritesBtn.classList.toggle("active", state.currentTab === "favorites");
    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= totalPages;
    pageIndicator.textContent = UI_MESSAGES.grid.pageLabel(
      state.currentPage,
      totalPages,
    );
  }

  function refreshCountTextFromCache() {
    const selectedCount = selectedItemIds.size;
    const baseText =
      state.currentTab === "favorites"
        ? UI_MESSAGES.grid.favoritesCount(latestVisibleItemCount)
        : UI_MESSAGES.grid.savedAndFavoritesCount(
            latestSavedItemCount,
            latestFavoritesCount,
          );
    countEl.textContent = selectedCount > 0
      ? `${baseText} | ${UI_MESSAGES.grid.selectedCount(selectedCount)}`
      : baseText;
  }

  function setCountText(normalized, visibleItems) {
    latestSavedItemCount = normalized.length;
    latestVisibleItemCount = visibleItems.length;
    latestFavoritesCount = normalized.filter((item) => item.favorite).length;
    refreshCountTextFromCache();
  }

  function createEmptyState(query) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const mascotVariant = getEmptyMascotVariant({
      query,
      currentTab: state.currentTab,
    });

    const mascot = document.createElement("img");
    mascot.className = "empty-mascot";
    mascot.src = getEmptyMascotSrc(state.themeMode, mascotVariant);
    mascot.dataset.variant = mascotVariant;
    mascot.alt = UI_MESSAGES.grid.emptyMascotAlt;

    const text = document.createElement("p");
    text.className = "empty-text";
    text.textContent = query
      ? UI_MESSAGES.grid.noSearchMatches
      : state.currentTab === "favorites"
        ? UI_MESSAGES.grid.noFavoritesYet
        : UI_MESSAGES.grid.emptyVaultPrompt;

    empty.append(mascot, text);
    return empty;
  }

  function updateEmptyStateMascotForTheme(themeMode = state.themeMode) {
    const mascotEl = grid.querySelector(".empty-mascot");
    if (!mascotEl) {
      return;
    }
    const mascotVariant = mascotEl.dataset.variant || getEmptyMascotVariant({
      query: state.searchTerm,
      currentTab: state.currentTab,
    });
    mascotEl.src = getEmptyMascotSrc(themeMode, mascotVariant);
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

    const previewRect = hoverPreviewEl.getBoundingClientRect();
    const maxX = window.innerWidth - previewRect.width;
    const maxY = window.innerHeight - previewRect.height;
    let left = x;
    let top = y;

    if (left > maxX) {
      left = Math.max(0, x - previewRect.width);
    }
    if (top > maxY) {
      top = Math.max(0, y - previewRect.height);
    }

    hoverPreviewEl.style.left = `${Math.max(0, left)}px`;
    hoverPreviewEl.style.top = `${Math.max(0, top)}px`;
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
    if (!getPopupMenuConfig().hoverPreviewEnabled) {
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
    if (!getPopupMenuConfig().hoverPreviewEnabled) {
      hideHoverPreview();
      return;
    }

    updateHoverPointerPosition(event);
    clearHoverPreviewTimer();
    hoverPreviewTimer = setTimeout(() => {
      hoverPreviewTimer = 0;
      showHoverPreview(previewUrl);
    }, getPopupMenuConfig().hoverPreviewDelayMs);
  }

  function resetDeleteButton(button) {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    button.classList.remove("delete-armed");
    button.textContent = "\u2715";
    button.title = UI_MESSAGES.grid.delete;
    button.setAttribute("aria-label", UI_MESSAGES.grid.delete);
  }

  function clearArmedDelete() {
    if (armedDeleteTimer) {
      clearTimeout(armedDeleteTimer);
      armedDeleteTimer = 0;
    }
    for (const button of armedDeleteButtons) {
      resetDeleteButton(button);
    }
    armedDeleteItemId = "";
    armedDeleteButtons = [];
  }

  function selectionHintText(count) {
    return count > 1
      ? UI_MESSAGES.grid.selectionHintMany(count)
      : UI_MESSAGES.grid.selectionHintSingle;
  }

  function showSelectionHint(count) {
    showTransientStatus(selectionHintText(count), "ok", TEMP_STATUS_DURATION_MS, {
      forceTemporary: true,
      preserveProgress: false,
    });
  }

  function updateSelectionForRender() {
    const next = new Set();
    for (const id of selectedItemIds) {
      if (latestVisiblePageIds.has(id)) {
        next.add(id);
      }
    }
    selectedItemIds.clear();
    for (const id of next) {
      selectedItemIds.add(id);
    }
  }

  function setCardSelected(card, selected) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  }

  function toggleCardSelection(itemId, card) {
    const previousSelection = new Set(selectedItemIds);
    const id = String(itemId);
    if (selectedItemIds.has(id)) {
      selectedItemIds.delete(id);
      setCardSelected(card, false);
    } else {
      selectedItemIds.add(id);
      setCardSelected(card, true);
    }
    if (
      shouldCancelArmedDeleteOnSelectionChange(
        armedDeleteItemId,
        previousSelection,
        selectedItemIds,
      )
    ) {
      clearArmedDelete();
    }
    refreshCountTextFromCache();
    showSelectionHint(selectedItemIds.size);
  }

  function removeCardFromSelection(itemId, card) {
    const previousSelection = new Set(selectedItemIds);
    const id = String(itemId);
    if (!selectedItemIds.has(id)) {
      return false;
    }

    selectedItemIds.delete(id);
    setCardSelected(card, false);
    if (
      shouldCancelArmedDeleteOnSelectionChange(
        armedDeleteItemId,
        previousSelection,
        selectedItemIds,
      )
    ) {
      clearArmedDelete();
    }
    refreshCountTextFromCache();
    showSelectionHint(selectedItemIds.size);
    return true;
  }

  function clearAllSelections() {
    if (selectedItemIds.size === 0) {
      return;
    }

    selectedItemIds.clear();
    for (const card of grid.querySelectorAll(".item.selected")) {
      setCardSelected(card, false);
    }
    refreshCountTextFromCache();
  }

  function clearSelections() {
    clearArmedDelete();
    clearAllSelections();
  }

  function resolveTargetIdsForAction(fallbackItemId) {
    const fallbackId = String(fallbackItemId || "");
    if (
      fallbackId &&
      selectedItemIds.size > 1 &&
      selectedItemIds.has(fallbackId)
    ) {
      return [...selectedItemIds];
    }
    return fallbackId ? [fallbackId] : [];
  }

  function armDeleteButton(button, actionKey, count = 1, targetIds = []) {
    clearArmedDelete();
    armedDeleteItemId = String(actionKey);

    const armedLabel =
      count > 1
        ? UI_MESSAGES.grid.confirmDeleteTitleMany(count)
        : UI_MESSAGES.grid.confirmDeleteTitleSingle;
    const armedGlyph = armedDeleteGlyph(count);
    const buttonsToArm = [];

    if (count > 1 && targetIds.length > 0) {
      for (const card of grid.querySelectorAll(".item")) {
        if (!targetIds.includes(card.dataset.itemId || "")) {
          continue;
        }
        const candidate = card.querySelector(".btn.danger");
        if (candidate instanceof HTMLElement) {
          buttonsToArm.push(candidate);
        }
      }
    } else if (button instanceof HTMLElement) {
      buttonsToArm.push(button);
    }

    armedDeleteButtons = buttonsToArm;
    for (const armedButton of armedDeleteButtons) {
      armedButton.classList.add("delete-armed");
      armedButton.textContent = armedGlyph;
      armedButton.title = armedLabel;
      armedButton.setAttribute("aria-label", armedLabel);
    }

    const hint =
      count > 1
        ? UI_MESSAGES.grid.confirmDeleteHintMany(count)
        : UI_MESSAGES.grid.confirmDeleteHintSingle;
    showTransientStatus(hint, "ok", TEMP_STATUS_DURATION_MS, {
      forceTemporary: true,
    });
    armedDeleteTimer = setTimeout(() => {
      clearArmedDelete();
    }, ARMED_DELETE_DURATION_MS);
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
      const copiedUrl = sanitizeCopyFallbackUrl(
        item.mediaUrl || item.sourceUrl || "",
      );
      if (!copiedUrl) {
        await safeLog("popup", "Copy url fallback blocked", {
          id: item.id,
        });
        return { ok: false, method: "none" };
      }
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

  function isGifLikeUrl(url) {
    const value = String(url || "");
    return (
      /\.gif(?:$|[?#])/i.test(value) ||
      /[?&]format=gif(?:$|&)/i.test(value)
    );
  }

  function isImageLikeUrl(url) {
    const value = String(url || "");
    return (
      /\.(png|jpe?g|webp|bmp|avif|heic|heif|svg)(?:$|[?#])/i.test(value) ||
      /[?&]format=(?:png|jpe?g|webp|bmp|avif)(?:$|&)/i.test(value)
    );
  }

  function resolveMediaCopyKind(item, copiedUrl = "") {
    const mime = String(item?.mimeType || item?.blob?.type || "")
      .trim()
      .toLowerCase();
    if (mime.startsWith("video/")) {
      return "video";
    }
    if (mime.includes("image/gif")) {
      return "gif";
    }
    if (mime.startsWith("image/")) {
      return "image";
    }

    if (isVideoLikeUrl(copiedUrl)) {
      return "video";
    }
    if (isGifLikeUrl(copiedUrl)) {
      return "gif";
    }
    if (isImageLikeUrl(copiedUrl)) {
      return "image";
    }

    return "unknown";
  }

  function deletedStatusTextForIds(ids) {
    const targetIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (targetIds.length > 1) {
      return UI_MESSAGES.grid.deletedMany(targetIds.length);
    }

    const item = latestItemById.get(targetIds[0]);
    const mediaKind = resolveMediaCopyKind(
      item,
      item?.mediaUrl || item?.sourceUrl || "",
    );
    if (mediaKind === "image") {
      return UI_MESSAGES.grid.deletedImageSingle || UI_MESSAGES.grid.deletedSingle;
    }
    if (mediaKind === "video") {
      return UI_MESSAGES.grid.deletedVideoSingle || UI_MESSAGES.grid.deletedSingle;
    }
    if (mediaKind === "gif") {
      return UI_MESSAGES.grid.deletedGifSingle || UI_MESSAGES.grid.deletedSingle;
    }
    return UI_MESSAGES.grid.deletedSingle;
  }

  function setCopyStatus(item, result) {
    if (!result?.ok) {
      showTransientStatus(UI_MESSAGES.grid.copyFailed, "error");
      return;
    }

    const copiedUrl = String(result.copiedUrl || "");
    const mediaKind = resolveMediaCopyKind(item, copiedUrl);

    if (result.method === "blob") {
      const label =
        mediaKind === "image"
          ? UI_MESSAGES.grid.copiedImage
          : UI_MESSAGES.grid.copiedGif;
      const hint =
        mediaKind === "image"
          ? UI_MESSAGES.grid.copiedImageLinkTip
          : UI_MESSAGES.grid.copiedGifLinkTip;
      showTransientStatus(`${label}\n${hint}`, "ok", COPY_HINT_DURATION_MS, {
        forceTemporary: true,
        preserveProgress: false,
      });
      return;
    }

    const label = mediaKind === "video"
      ? UI_MESSAGES.grid.copiedVideoLink
      : mediaKind === "image"
        ? UI_MESSAGES.grid.copiedImageLink
        : UI_MESSAGES.grid.copiedGifLink;
    const hint = mediaKind === "video"
      ? ""
      : mediaKind === "image"
        ? UI_MESSAGES.grid.copiedImageLinkTip
        : UI_MESSAGES.grid.copiedGifLinkTip;
    showTransientStatus(
      hint ? `${label}\n${hint}` : label,
      "ok",
      COPY_HINT_DURATION_MS,
      {
        forceTemporary: true,
        preserveProgress: false,
      },
    );
  }

  async function removeItems(ids, focusItemId = "") {
    const targetIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (!targetIds.length) {
      return;
    }

    clearAllSelections();
    queueRemovalFocusRestore(focusItemId || targetIds[0]);
    await Promise.all(targetIds.map((id) => idbDelete(id)));

    for (const id of targetIds) {
      const objectUrl = objectUrlById.get(id);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrlById.delete(id);
      }
      selectedItemIds.delete(id);
    }
    await render();
  }

  async function setFavoriteForItems(ids, favorite) {
    const targetIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (!targetIds.length) {
      return;
    }

    clearAllSelections();

    const updates = targetIds
      .map((id) => latestItemById.get(id))
      .filter(Boolean)
      .map((item) => ({
        ...item,
        favorite: Boolean(favorite),
      }));
    if (!updates.length) {
      return;
    }

    await Promise.all(updates.map((item) => idbSave(item)));
    await safeLog("popup", "Favorite toggled", {
      ids: updates.map((item) => item.id),
      favorite: Boolean(favorite),
      count: updates.length,
    });
    await render();
  }

  async function renameItem(item) {
    const currentName = item.name || "";
    const nextName = window.prompt(UI_MESSAGES.grid.renamePrompt, currentName);
    if (nextName === null) {
      return;
    }

    clearAllSelections();
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

    state.pendingFocusRestore = {
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

  function blurSelectionResetInputs() {
    if (importInput instanceof HTMLElement) {
      importInput.blur();
    }
    if (searchInput instanceof HTMLElement) {
      searchInput.blur();
    }
  }

  function restorePendingFocus() {
    if (!state.pendingFocusRestore) {
      return;
    }

    const focusState = state.pendingFocusRestore;
    state.pendingFocusRestore = null;

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
        ? UI_MESSAGES.grid.invalidLegacyVideo
        : UI_MESSAGES.grid.invalidMediaEntry;

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      createButton({
        className: "btn",
        text: UI_MESSAGES.grid.remove,
        title: UI_MESSAGES.grid.delete,
        onClick: () => removeItems([item.id], item.id),
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
    media.alt = UI_MESSAGES.grid.savedGifAlt;
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
    setCardSelected(card, selectedItemIds.has(String(item.id)));
    const media = createPreviewMedia(item, previewUrl);

    const meta = document.createElement("div");
    meta.className = "meta";

    const nameRow = document.createElement("div");
    nameRow.className = "name-row";

    const nameText = document.createElement("div");
    nameText.className = "name";
    nameText.textContent =
      item.name && item.name.trim() ? item.name.trim() : UI_MESSAGES.grid.untitled;

    const renameBtn = createButton({
      className: "name-btn",
      text: "\u270E",
      title: UI_MESSAGES.grid.rename,
      label: UI_MESSAGES.grid.rename,
      onClick: () => renameItem(item),
    });

    nameRow.append(nameText, renameBtn);

    const urlText = document.createElement("div");
    urlText.className = "url";
    urlText.textContent = hostFromUrl(item.sourceUrl || item.mediaUrl || "");

    const sizeText = document.createElement("div");
    sizeText.className = "size";
    sizeText.textContent = UI_MESSAGES.grid.sizeLabel(
      formatBytes(item.blob?.size || 0),
    );

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = createButton({
      className: "btn primary",
      text: "\u29C9",
      title: UI_MESSAGES.grid.copy,
      label: UI_MESSAGES.grid.copy,
    });
    copyBtn.addEventListener("click", async () => {
      clearAllSelections();
      const result = await copyItemBlob(item);
      copyBtn.textContent = result.ok ? "\u2713" : "!";
      setCopyStatus(item, result);
      setTimeout(() => {
        copyBtn.textContent = "\u29C9";
      }, getPopupMenuConfig().copyFeedbackResetDelayMs);
    });

    const favoriteBtn = createButton({
      className: "btn",
      text: item.favorite ? "\u2605" : "\u2606",
      title: `${item.favorite ? UI_MESSAGES.grid.unfavorite : UI_MESSAGES.grid.favorite} ${UI_MESSAGES.grid.favoriteBatchHint}`,
      label: `${item.favorite ? UI_MESSAGES.grid.unfavorite : UI_MESSAGES.grid.favorite} ${UI_MESSAGES.grid.favoriteBatchHint}`,
      onClick: () => {
        const targetIds = resolveTargetIdsForAction(item.id);
        const nextFavorite = !Boolean(item.favorite);
        void setFavoriteForItems(targetIds, nextFavorite);
      },
    });
    if (item.favorite) {
      favoriteBtn.classList.add("favorite-active");
    }

    const removeBtn = createButton({
      className: "btn danger",
      text: "\u2715",
      title: UI_MESSAGES.grid.delete,
      label: UI_MESSAGES.grid.delete,
    });
    removeBtn.addEventListener("click", () => {
      const targetIds = resolveTargetIdsForAction(item.id);
      const actionKey = targetIds.length > 1
        ? `batch:${[...targetIds].sort().join(",")}`
        : String(item.id);

      if (armedDeleteItemId === actionKey) {
        clearArmedDelete();
        showTransientStatus(
          deletedStatusTextForIds(targetIds),
          "ok",
          TEMP_STATUS_DURATION_MS,
          {
            forceTemporary: true,
            preserveProgress: false,
          },
        );
        void removeItems(targetIds, item.id);
        return;
      }
      armDeleteButton(removeBtn, actionKey, targetIds.length, targetIds);
    });

    actions.append(copyBtn, favoriteBtn, removeBtn);
    meta.append(nameRow, urlText, sizeText, actions);
    card.append(media, meta);
    card.addEventListener("mousedown", (event) => {
      const rawTarget = event.target;
      if (!(rawTarget instanceof Element)) {
        return;
      }
      if (rawTarget.closest(".btn, .name-btn")) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      blurSelectionResetInputs();
      if (event.shiftKey) {
        event.preventDefault();
      }
    });
    card.addEventListener("click", (event) => {
      const rawTarget = event.target;
      if (!(rawTarget instanceof Element)) {
        return;
      }
      if (rawTarget.closest(".btn, .name-btn")) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      blurSelectionResetInputs();
      event.preventDefault();
      if (event.shiftKey) {
        toggleCardSelection(item.id, card);
        return;
      }
      removeCardFromSelection(item.id, card);
    });
    return card;
  }

  async function render() {
    hideHoverPreview();
    clearArmedDelete();
    const renderId = ++state.renderSequence;
    const items = await idbGetAllMedia();
    if (renderId !== state.renderSequence) {
      return;
    }

    const { normalized, visibleItems, query } = getFilteredItems(items);
    latestItemById = new Map(normalized.map((item) => [String(item.id), item]));
    const { totalPages, pagedItemsMeta } = getPagedItemsMeta(visibleItems);
    latestVisiblePageIds = new Set(
      pagedItemsMeta.map((item) => String(item.id)),
    );
    updateSelectionForRender();
    await safeLog("popup", "Render media grid", {
      count: visibleItems.length,
      tab: state.currentTab,
    });
    setCountText(normalized, visibleItems);
    updatePager(totalPages);

    pruneObjectUrlsForVisibleIds(new Set(pagedItemsMeta.map((item) => item.id)));
    grid.innerHTML = "";

    if (pagedItemsMeta.length === 0) {
      if (renderId !== state.renderSequence) {
        return;
      }
      grid.appendChild(createEmptyState(query));
      restorePendingFocus();
      return;
    }

    const blobById = await idbGetMediaBlobs(pagedItemsMeta.map((item) => item.id));
    if (renderId !== state.renderSequence) {
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

  function cleanupObjectUrls() {
    hideHoverPreview();
    clearSelections();
    for (const url of objectUrlById.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrlById.clear();
  }

  return {
    clearSelections,
    cleanupObjectUrls,
    hideHoverPreview,
    render,
    updateEmptyStateMascotForTheme,
  };
}
