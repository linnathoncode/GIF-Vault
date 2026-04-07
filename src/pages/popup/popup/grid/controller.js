import {
  idbDelete,
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbSave,
} from "../../../../lib/db.js";
import { formatBytes, hostFromUrl } from "../../../../lib/ui.js";
import { safeLog } from "../../../../lib/log.js";
import { UI_MESSAGES } from "../../../../lib/messages.js";
import { POPUP_GRID } from "../../../../lib/settings.js";
import {
  armedDeleteGlyph,
  selectionIdsChanged,
  shouldCancelArmedDeleteOnSelectionChange,
  createGridFocusController,
} from "./interaction.js";
import { createGridDataController } from "./data.js";
import {
  createGridPreviewController,
  createStoredMediaKindDetector,
  resolveMediaCopyKind,
} from "./media.js";
import {
  attachCardSelectionHandlers,
  copyItemUrl,
  createButton,
  createHoverInfoRow,
  createInvalidCard,
  createPreviewMedia,
  sanitizeCopyUrl,
  setButtonIcon,
} from "./card.js";

export {
  armedDeleteGlyph,
  selectionIdsChanged,
  shouldCancelArmedDeleteOnSelectionChange,
};
export {
  sanitizeCopyUrl,
} from "./card.js";

/**
 * Creates the popup grid controller that coordinates filtering, rendering,
 * selection state, card actions, and focus/preview behavior for the vault.
 *
 * The returned handlers are intended to be wired by the popup page coordinator.
 */
export function createPopupGridController({
  refs,
  state,
  getPopupMenuConfig,
  showTransientStatus,
  onSelectionChange,
}) {
  const TEMP_STATUS_DURATION_MS = POPUP_GRID.transientStatusDurationMs;
  const ARMED_DELETE_DURATION_MS = POPUP_GRID.armedDeleteDurationMs;
  const COPY_HINT_DURATION_MS = POPUP_GRID.copyHintDurationMs;
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
  const mediaKindCacheById = new Map();
  const selectedItemIds = new Set();
  let latestItemById = new Map();
  let latestVisiblePageIds = new Set();
  let armedDeleteItemId = "";
  let armedDeleteTimer = 0;
  let armedDeleteButtons = [];
  const detectStoredMediaKind = createStoredMediaKindDetector(mediaKindCacheById);
  const dataController = createGridDataController({
    state,
    getPopupMenuConfig,
    countEl,
    tabAllBtn,
    tabFavoritesBtn,
    prevPageBtn,
    nextPageBtn,
    pageIndicator,
  });
  const previewController = createGridPreviewController({
    hoverPreviewEl,
    hoverPreviewImgEl,
    getPopupMenuConfig,
    objectUrlById,
    mediaKindCacheById,
  });
  const focusController = createGridFocusController({
    grid,
    importInput,
    searchInput,
    state,
  });
  const deleteButtonLabelWithBatchHint = () =>
    `${UI_MESSAGES.grid.delete} ${UI_MESSAGES.grid.deleteBatchHint}`;
  const notifySelectionChange = () => {
    if (typeof onSelectionChange === "function") {
      onSelectionChange(selectedItemIds.size);
    }
  };

  function resetDeleteButton(button) {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    button.classList.remove("delete-armed");
    setButtonIcon(button, "icon-delete.svg");
    const deleteLabel = deleteButtonLabelWithBatchHint();
    button.title = deleteLabel;
    button.setAttribute("aria-label", deleteLabel);
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
    notifySelectionChange();
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
    dataController.refreshCountTextFromCache(selectedItemIds.size);
    showSelectionHint(selectedItemIds.size);
    notifySelectionChange();
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
    dataController.refreshCountTextFromCache(selectedItemIds.size);
    showSelectionHint(selectedItemIds.size);
    notifySelectionChange();
    return true;
  }

  function clearAllSelections() {
    if (selectedItemIds.size === 0) {
      notifySelectionChange();
      return;
    }

    selectedItemIds.clear();
    for (const card of grid.querySelectorAll(".item.selected")) {
      setCardSelected(card, false);
    }
    dataController.refreshCountTextFromCache(selectedItemIds.size);
    notifySelectionChange();
  }

  function clearSelections() {
    clearArmedDelete();
    clearAllSelections();
  }

  function getSelectedCount() {
    return selectedItemIds.size;
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
    const armedIconFile = count > 1 ? "icon-warning.svg" : "icon-confirm.svg";
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
      setButtonIcon(armedButton, armedIconFile, armedGlyph);
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
    if (mediaKind === "animated-webp") {
      return UI_MESSAGES.grid.deletedAnimatedWebpSingle || UI_MESSAGES.grid.deletedSingle;
    }
    return UI_MESSAGES.grid.deletedSingle;
  }

  function setCopyStatus(item, result) {
    if (!result?.ok) {
      if (result?.reason === "no-source-url") {
        showTransientStatus(UI_MESSAGES.grid.copyNoSourceUrlForLocal, "error");
        return;
      }
      showTransientStatus(UI_MESSAGES.grid.copyFailed, "error");
      return;
    }

    const copiedUrl = String(result.copiedUrl || "");
    const mediaKind = resolveMediaCopyKind(item, copiedUrl);

    const label = mediaKind === "video"
      ? UI_MESSAGES.grid.copiedVideoLink
      : mediaKind === "animated-webp"
        ? UI_MESSAGES.grid.copiedAnimatedWebpLink
      : mediaKind === "image"
        ? UI_MESSAGES.grid.copiedImageLink
        : UI_MESSAGES.grid.copiedGifLink;
    const hint = mediaKind === "video"
      ? UI_MESSAGES.grid.copiedVideoLinkTip
      : mediaKind === "animated-webp"
        ? UI_MESSAGES.grid.copiedLinkTip
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
    focusController.queueRemovalFocusRestore(focusItemId || targetIds[0]);
    await Promise.all(targetIds.map((id) => idbDelete(id)));

    for (const id of targetIds) {
      const objectUrl = objectUrlById.get(id);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrlById.delete(id);
      }
      mediaKindCacheById.delete(String(id));
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

  function buildCard(item) {
    if (item.kind === "video") {
      return createInvalidCard({
        item,
        createButton,
        UI_MESSAGES,
        deleteButtonLabelWithBatchHint,
        onDelete: () => removeItems([item.id], item.id),
      });
    }

    const previewUrl = previewController.buildPreviewUrl(item);
    if (!previewUrl) {
      return createInvalidCard({
        item,
        createButton,
        UI_MESSAGES,
        deleteButtonLabelWithBatchHint,
        onDelete: () => removeItems([item.id], item.id),
      });
    }

    const card = document.createElement("article");
    card.className = "item";
    card.dataset.itemId = String(item.id);
    setCardSelected(card, selectedItemIds.has(String(item.id)));
    const media = createPreviewMedia({
      item,
      previewUrl,
      previewController,
      hoverPreviewEl,
      UI_MESSAGES,
    });

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
      actionKey: "rename",
      title: UI_MESSAGES.grid.rename,
      label: UI_MESSAGES.grid.rename,
      onClick: () => renameItem(item),
    });
    setButtonIcon(renameBtn, "icon-rename.svg");

    nameRow.append(nameText);

    const hoverInfoText = createHoverInfoRow({
      item,
      hostFromUrl,
      formatBytes,
      UI_MESSAGES,
    });

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = createButton({
      className: "btn primary",
      actionKey: "copy",
      title: UI_MESSAGES.grid.copy,
      label: UI_MESSAGES.grid.copy,
    });
    setButtonIcon(copyBtn, "icon-copy.svg");
    copyBtn.addEventListener("click", async () => {
      clearAllSelections();
      const result = await copyItemUrl(item);
      const feedbackIcon = result.ok ? "icon-copy-success.svg" : "icon-warning.svg";
      const feedbackGlyph = result.ok ? "\u2713" : "!";
      setButtonIcon(copyBtn, feedbackIcon, feedbackGlyph);
      setCopyStatus(item, result);
      setTimeout(() => {
        setButtonIcon(copyBtn, "icon-copy.svg");
      }, getPopupMenuConfig().copyFeedbackResetDelayMs);
    });

    const favoriteBtn = createButton({
      className: "btn",
      actionKey: "favorite",
      title: `${item.favorite ? UI_MESSAGES.grid.unfavorite : UI_MESSAGES.grid.favorite} ${UI_MESSAGES.grid.favoriteBatchHint}`,
      label: `${item.favorite ? UI_MESSAGES.grid.unfavorite : UI_MESSAGES.grid.favorite} ${UI_MESSAGES.grid.favoriteBatchHint}`,
      onClick: () => {
        const targetIds = resolveTargetIdsForAction(item.id);
        const nextFavorite = !Boolean(item.favorite);
        focusController.queueActionFocusRestore(item.id, "favorite");
        void setFavoriteForItems(targetIds, nextFavorite);
      },
    });
    setButtonIcon(
      favoriteBtn,
      item.favorite ? "icon-star-filled.svg" : "icon-star.svg",
    );
    if (item.favorite) {
      favoriteBtn.classList.add("favorite-active");
    }

    const removeBtn = createButton({
      className: "btn danger",
      actionKey: "delete",
      title: deleteButtonLabelWithBatchHint(),
      label: deleteButtonLabelWithBatchHint(),
    });
    setButtonIcon(removeBtn, "icon-delete.svg");
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

    actions.append(renameBtn, copyBtn, favoriteBtn, removeBtn);
    meta.append(nameRow, actions, hoverInfoText);
    card.append(media, meta);
    attachCardSelectionHandlers({
      card,
      itemId: item.id,
      selectedItemIds,
      focusController,
      toggleCardSelection,
      removeCardFromSelection,
    });
    return card;
  }

  async function render() {
    previewController.hideHoverPreview();
    clearArmedDelete();
    const gridFocusSnapshot =
      state.pendingFocusRestore ? null : focusController.captureGridFocusSnapshot();
    const previousScrollTop = grid.scrollTop;
    const previousScrollLeft = grid.scrollLeft;
    const renderId = ++state.renderSequence;
    const items = await idbGetAllMedia();
    if (renderId !== state.renderSequence) {
      return;
    }

    const { normalized, visibleItems, query } = dataController.getFilteredItems(items);
    latestItemById = new Map(normalized.map((item) => [String(item.id), item]));
    const { totalPages, pagedItemsMeta } = dataController.getPagedItemsMeta(visibleItems);
    latestVisiblePageIds = new Set(
      pagedItemsMeta.map((item) => String(item.id)),
    );
    updateSelectionForRender();
    await safeLog("popup", "Render media grid", {
      count: visibleItems.length,
      tab: state.currentTab,
    });
    dataController.setCountText(normalized, visibleItems, selectedItemIds.size);
    dataController.updatePager(totalPages);

    previewController.pruneObjectUrlsForVisibleIds(new Set(pagedItemsMeta.map((item) => item.id)));
    grid.innerHTML = "";

    if (pagedItemsMeta.length === 0) {
      if (renderId !== state.renderSequence) {
        return;
      }
      grid.appendChild(dataController.createEmptyState(query));
      focusController.restorePendingFocus();
      return;
    }

    const blobById = await idbGetMediaBlobs(pagedItemsMeta.map((item) => item.id));
    if (renderId !== state.renderSequence) {
      return;
    }

    const pagedItemsWithBlobs = pagedItemsMeta.map((item) => ({
      ...item,
      blob: blobById.get(item.id) || null,
    }));
    const pagedItems = await Promise.all(
      pagedItemsWithBlobs.map(async (item) => ({
        ...item,
        mediaKind: await detectStoredMediaKind(item),
      })),
    );
    if (renderId !== state.renderSequence) {
      return;
    }

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

    if (totalPages > 1) {
      grid.appendChild(dataController.createPaginationHint());
    }

    focusController.restoreGridScrollPosition(previousScrollTop, previousScrollLeft);

    if (state.pendingFocusRestore) {
      focusController.restorePendingFocus();
      return;
    }
    focusController.restoreFocusSnapshot(gridFocusSnapshot);
  }

  function cleanupObjectUrls() {
    clearSelections();
    previewController.cleanupObjectUrls();
  }

  async function deleteSelectedItems() {
    const targetIds = [...selectedItemIds];
    if (targetIds.length === 0) {
      return false;
    }

    const deletedStatusText = deletedStatusTextForIds(targetIds);
    await removeItems(targetIds, targetIds[0]);
    showTransientStatus(deletedStatusText, "ok", TEMP_STATUS_DURATION_MS, {
      forceTemporary: true,
      preserveProgress: false,
    });
    return true;
  }

  return {
    clearSelections,
    cleanupObjectUrls,
    deleteSelectedItems,
    getSelectedCount,
    hideHoverPreview: previewController.hideHoverPreview,
    render,
    updateEmptyStateMascotForTheme(themeMode = state.themeMode) {
      dataController.updateEmptyStateMascotForTheme(grid, themeMode);
    },
  };
}

