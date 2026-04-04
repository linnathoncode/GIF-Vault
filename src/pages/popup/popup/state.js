import { POPUP_MENU } from "../../../lib/settings.js";

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

function createPopupState() {
  const state = {
    activeImportRequestId: "",
    importTerminationRequestId: "",
    isImportTerminationPending: false,
    currentImportState: null,
    currentPage: 1,
    currentTab: POPUP_MENU.defaultTab,
    isBootLoading: true,
    pendingFocusRestore: null,
    popupMenuConfig: defaultPopupMenuConfig(),
    renderSequence: 0,
    searchTerm: "",
    suppressNextImportStateClearUiReset: false,
    themeMode: "light",
  };

  function setImportState(importState) {
    state.currentImportState = importState?.text ? importState : null;
  }

  function setActiveImportRequestId(requestId) {
    state.activeImportRequestId = String(requestId || "").trim();
  }

  function setImportTerminationPending(requestId) {
    state.isImportTerminationPending = true;
    state.importTerminationRequestId = String(requestId || "").trim();
  }

  function clearImportTerminationPending() {
    state.isImportTerminationPending = false;
    state.importTerminationRequestId = "";
  }

  return {
    state,
    defaultPopupMenuConfig,
    setBootLoading(isBootLoading) {
      state.isBootLoading = Boolean(isBootLoading);
    },
    setPopupMenuConfig(popupMenuConfig) {
      state.popupMenuConfig = popupMenuConfig;
    },
    setCurrentPage(page) {
      state.currentPage = Number(page) || 1;
    },
    setCurrentTab(tab) {
      state.currentTab = String(tab || "");
    },
    setSearchTerm(searchTerm) {
      state.searchTerm = String(searchTerm || "");
    },
    setThemeMode(themeMode) {
      state.themeMode = String(themeMode || "light");
    },
    setSuppressImportStateUiReset(value) {
      state.suppressNextImportStateClearUiReset = Boolean(value);
    },
    resetActiveImportSession() {
      state.activeImportRequestId = "";
      clearImportTerminationPending();
      state.currentImportState = null;
    },
    setImportState,
    setActiveImportRequestId,
    setImportTerminationPending,
    clearImportTerminationPending,
    applyImportState(importState) {
      setImportState(importState);
      if (importState?.active) {
        setActiveImportRequestId(importState.requestId || state.activeImportRequestId);
      } else if (
        importState?.requestId &&
        importState.requestId === state.activeImportRequestId
      ) {
        setActiveImportRequestId("");
      }
      if (!importState?.active) {
        const requestId = String(importState?.requestId || "").trim();
        if (
          !state.importTerminationRequestId ||
          !requestId ||
          requestId === state.importTerminationRequestId
        ) {
          clearImportTerminationPending();
        }
      }
    },
  };
}

export { createPopupState };
