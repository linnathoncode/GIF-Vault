// Popup grid controller that composes the card, data, interaction, and media helpers.
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
  createGridActionController,
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
    // Keep only selections that are still visible on the current page.
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

  function armDeleteButton(button, actionKey, count = 1, targetIds = []) {
    clearArmedDelete();
    armedDeleteItemId = String(actionKey);

    // Batch delete confirmation needs to arm every matching card action, not just one button.
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

  const actionController = createGridActionController({
    UI_MESSAGES,
    TEMP_STATUS_DURATION_MS,
    COPY_HINT_DURATION_MS,
    idbDelete,
    idbSave,
    safeLog,
    resolveMediaCopyKind,
    latestItemByIdRef: () => latestItemById,
    objectUrlById,
    mediaKindCacheById,
    selectedItemIds,
    clearAllSelections,
    focusController,
    render,
    showTransientStatus,
  });

  function buildCard(item) {
    if (item.kind === "video") {
      return createInvalidCard({
        item,
        createButton,
        UI_MESSAGES,
        deleteButtonLabelWithBatchHint,
        onDelete: () => actionController.removeItems([item.id], item.id),
      });
    }

    const previewUrl = previewController.buildPreviewUrl(item);
    if (!previewUrl) {
      return createInvalidCard({
        item,
        createButton,
        UI_MESSAGES,
        deleteButtonLabelWithBatchHint,
        onDelete: () => actionController.removeItems([item.id], item.id),
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
      onClick: () => actionController.renameItem(item),
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
      actionController.setCopyStatus(item, result);
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
        const targetIds = actionController.resolveTargetIdsForAction(item.id);
        const nextFavorite = !Boolean(item.favorite);
        focusController.queueActionFocusRestore(item.id, "favorite");
        void actionController.setFavoriteForItems(targetIds, nextFavorite);
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
      const targetIds = actionController.resolveTargetIdsForAction(item.id);
      const actionKey = targetIds.length > 1
        ? `batch:${[...targetIds].sort().join(",")}`
        : String(item.id);

      if (armedDeleteItemId === actionKey) {
        clearArmedDelete();
        showTransientStatus(
          actionController.deletedStatusTextForIds(targetIds),
          "ok",
          TEMP_STATUS_DURATION_MS,
          {
            forceTemporary: true,
            preserveProgress: false,
          },
        );
        void actionController.removeItems(targetIds, item.id);
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
    // Rerenders can be superseded, so guard with a sequence id and restore UI state afterward.
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

  return {
    clearSelections,
    cleanupObjectUrls,
    deleteSelectedItems: actionController.deleteSelectedItems,
    getSelectedCount,
    hideHoverPreview: previewController.hideHoverPreview,
    render,
    updateEmptyStateMascotForTheme(themeMode = state.themeMode) {
      dataController.updateEmptyStateMascotForTheme(grid, themeMode);
    },
  };
}

