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
