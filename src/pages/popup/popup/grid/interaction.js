// Focus, selection, and destructive-action helpers for popup grid cards.
export function selectionIdsChanged(previousIds, nextIds) {
  // Compare as sorted strings so selection changes are detected regardless of set order.
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

export function createGridFocusController({ grid, importInput, searchInput, state }) {
  function focusFirstAvailableAction(card) {
    if (!card) {
      return false;
    }

    const nextTarget = card.querySelector(".btn.danger, .btn, .name-btn");
    if (!(nextTarget instanceof HTMLElement)) {
      return false;
    }

    nextTarget.focus({ preventScroll: true });
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

  function queueActionFocusRestore(itemId, actionKey) {
    const cards = Array.from(grid.querySelectorAll(".item"));
    const currentCard = document.activeElement?.closest(".item");
    const fallbackIndex = cards.findIndex(
      (card) => card.dataset.itemId === String(itemId),
    );
    const cardIndex = cards.indexOf(currentCard);
    const sourceIndex = cardIndex >= 0 ? cardIndex : fallbackIndex;

    state.pendingFocusRestore = {
      type: "action",
      actionKey: String(actionKey || ""),
      itemId: String(itemId || ""),
      index: sourceIndex >= 0 ? sourceIndex : 0,
    };
  }

  function captureGridFocusSnapshot() {
    const focused = document.activeElement;
    if (!(focused instanceof Element) || !grid.contains(focused)) {
      return null;
    }

    const cards = Array.from(grid.querySelectorAll(".item"));
    const card = focused.closest(".item");
    if (!card) {
      return null;
    }

    const actionNode = focused.closest("[data-action]");
    const actionKey =
      actionNode instanceof HTMLElement
        ? String(actionNode.dataset.action || "")
        : "";
    const index = Math.max(0, cards.indexOf(card));
    return {
      type: "action",
      itemId: String(card.dataset.itemId || ""),
      actionKey,
      index,
    };
  }

  function restorePendingFocus() {
    if (!state.pendingFocusRestore) {
      return;
    }

    const focusState = state.pendingFocusRestore;
    state.pendingFocusRestore = null;

    // Prefer the original action target, then fall back to a nearby card action.
    const cards = Array.from(grid.querySelectorAll(".item"));
    if (cards.length === 0) {
      importInput.focus({ preventScroll: true });
      return;
    }

    if (focusState.type === "action") {
      const targetCard = cards.find(
        (card) => card.dataset.itemId === String(focusState.itemId || ""),
      );
      if (targetCard) {
        const actionTarget = targetCard.querySelector(
          `[data-action="${String(focusState.actionKey || "")}"]`,
        );
        if (actionTarget instanceof HTMLElement) {
          actionTarget.focus({ preventScroll: true });
          return;
        }
        if (focusFirstAvailableAction(targetCard)) {
          return;
        }
      }
    }

    if (focusState.type !== "removal" && focusState.type !== "action") {
      return;
    }

    const targetIndex = Math.min(focusState.index, cards.length - 1);
    if (focusFirstAvailableAction(cards[targetIndex])) {
      return;
    }

    focusFirstAvailableAction(cards[targetIndex - 1] || cards[0]);
  }

  function restoreFocusSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    // Re-find the old action or a nearby action after rerendering replaces the DOM.
    const cards = Array.from(grid.querySelectorAll(".item"));
    if (cards.length === 0) {
      return;
    }

    const targetCard = cards.find(
      (card) => card.dataset.itemId === String(snapshot.itemId || ""),
    );
    if (targetCard) {
      if (snapshot.actionKey) {
        const actionTarget = targetCard.querySelector(
          `[data-action="${String(snapshot.actionKey)}"]`,
        );
        if (actionTarget instanceof HTMLElement) {
          actionTarget.focus({ preventScroll: true });
          return;
        }
      }
      if (focusFirstAvailableAction(targetCard)) {
        return;
      }
    }

    const targetIndex = Math.min(
      Math.max(0, Number(snapshot.index) || 0),
      cards.length - 1,
    );
    focusFirstAvailableAction(cards[targetIndex] || cards[0]);
  }

  function restoreGridScrollPosition(scrollTop, scrollLeft) {
    const top = Math.max(0, Number(scrollTop) || 0);
    const left = Math.max(0, Number(scrollLeft) || 0);
    const apply = () => {
      grid.scrollTop = top;
      grid.scrollLeft = left;
    };
    apply();
    requestAnimationFrame(() => {
      apply();
    });
    setTimeout(apply, 0);
  }

  return {
    blurSelectionResetInputs,
    captureGridFocusSnapshot,
    queueActionFocusRestore,
    queueRemovalFocusRestore,
    restoreFocusSnapshot,
    restoreGridScrollPosition,
    restorePendingFocus,
  };
}

export function createGridActionController({
  UI_MESSAGES,
  TEMP_STATUS_DURATION_MS,
  COPY_HINT_DURATION_MS,
  idbDelete,
  idbSave,
  safeLog,
  resolveMediaCopyKind,
  latestItemByIdRef,
  objectUrlById,
  mediaKindCacheById,
  selectedItemIds,
  clearAllSelections,
  focusController,
  render,
  showTransientStatus,
}) {
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

  function deletedStatusTextForIds(ids) {
    const targetIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (targetIds.length > 1) {
      return UI_MESSAGES.grid.deletedMany(targetIds.length);
    }

    const latestItemById = latestItemByIdRef();
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
    const latestItemById = latestItemByIdRef();

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
    deletedStatusTextForIds,
    deleteSelectedItems,
    removeItems,
    renameItem,
    resolveTargetIdsForAction,
    setCopyStatus,
    setFavoriteForItems,
  };
}
