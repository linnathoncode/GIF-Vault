import {
  idbDelete,
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbSave,
} from "../../lib/db.js";
import { fileExtensionFromMime } from "../../lib/media.js";
import { formatBytes, hostFromUrl } from "../../lib/ui.js";
import { safeLog } from "../../lib/log.js";

// Vault filtering, rendering, and item actions.
export function createPopupGridController({
  refs,
  state,
  getPopupMenuConfig,
  showTransientStatus,
}) {
  const {
    countEl,
    grid,
    hoverPreviewEl,
    hoverPreviewImgEl,
    importInput,
    nextPageBtn,
    pageIndicator,
    prevPageBtn,
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
  let armedDeleteButton = null;

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
    pageIndicator.textContent = `Page ${state.currentPage} / ${totalPages}`;
  }

  function setCountText(normalized, visibleItems) {
    const favoritesCount = normalized.filter((item) => item.favorite).length;
    countEl.textContent =
      state.currentTab === "favorites"
        ? `${visibleItems.length} favorite(s)`
        : `${normalized.length} saved | ${favoritesCount} favorite(s)`;
  }

  function createEmptyState(query) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query
      ? "No matches for your search."
      : state.currentTab === "favorites"
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

  function selectionHintText(count) {
    return count > 1
      ? `${count} selected. Favorite/Delete act on selected cards.`
      : "Shift+Click cards to multi-select.";
  }

  function showSelectionHint(count) {
    showTransientStatus(selectionHintText(count), "ok", 1200, {
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
    const id = String(itemId);
    if (selectedItemIds.has(id)) {
      selectedItemIds.delete(id);
      setCardSelected(card, false);
    } else {
      selectedItemIds.add(id);
      setCardSelected(card, true);
    }
    showSelectionHint(selectedItemIds.size);
  }

  function removeCardFromSelection(itemId, card) {
    const id = String(itemId);
    if (!selectedItemIds.has(id)) {
      return false;
    }

    selectedItemIds.delete(id);
    setCardSelected(card, false);
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

  function armDeleteButton(button, actionKey, count = 1) {
    clearArmedDelete();
    armedDeleteItemId = String(actionKey);
    armedDeleteButton = button;
    if (button instanceof HTMLElement) {
      button.classList.add("delete-armed");
      button.textContent = "\u2713";
      button.title =
        count > 1 ? `Confirm delete ${count} items` : "Confirm delete";
      button.setAttribute(
        "aria-label",
        count > 1 ? `Confirm delete ${count} items` : "Confirm delete",
      );
    }
    const hint =
      count > 1
        ? `Click delete again to remove ${count} selected items.`
        : "Click delete again to confirm.";
    showTransientStatus(hint, "ok", 2000, {
      forceTemporary: true,
    });
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
    const nextName = window.prompt("Name this GIF:", currentName);
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
        ? "Legacy video entry is no longer supported"
        : "Invalid media entry";

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      createButton({
        className: "btn",
        text: "Remove",
        title: "Delete",
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
    urlText.textContent = hostFromUrl(item.sourceUrl || item.mediaUrl || "");

    const sizeText = document.createElement("div");
    sizeText.className = "size";
    sizeText.textContent = `Size: ${formatBytes(item.blob?.size || 0)}`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = createButton({
      className: "btn primary",
      text: "\u29C9",
      title: "Copy",
      label: "Copy",
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
      title: `${item.favorite ? "Unfavorite" : "Favorite"} (batch applies to selected cards)`,
      label: `${item.favorite ? "Unfavorite" : "Favorite"} (batch applies to selected cards)`,
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
      title: "Delete",
      label: "Delete",
    });
    removeBtn.addEventListener("click", () => {
      const targetIds = resolveTargetIdsForAction(item.id);
      const actionKey = targetIds.length > 1
        ? `batch:${[...targetIds].sort().join(",")}`
        : String(item.id);

      if (armedDeleteItemId === actionKey) {
        clearArmedDelete();
        const count = targetIds.length;
        showTransientStatus(
          count > 1 ? `${count} GIFs deleted.` : "GIF deleted.",
          "ok",
        );
        void removeItems(targetIds, item.id);
        return;
      }
      armDeleteButton(removeBtn, actionKey, targetIds.length);
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
    clearArmedDelete();
    for (const url of objectUrlById.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrlById.clear();
  }

  return {
    cleanupObjectUrls,
    hideHoverPreview,
    render,
  };
}
