import { STORAGE_KEYS, POPUP_BOOT } from "../../../lib/settings.js";

const FALLBACK_POPUP_TAB = POPUP_BOOT.fallbackTab;

function normalizePopupTab(value, fallback = FALLBACK_POPUP_TAB) {
  return value === "favorites"
    ? "favorites"
    : value === "all"
      ? "all"
      : fallback;
}

export function createPopupTabController({ state, stateStore }) {
  function getStoredLastPopupTab() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.popupLastTab], (result) => {
        resolve(normalizePopupTab(result?.[STORAGE_KEYS.popupLastTab]));
      });
    });
  }

  function storeLastPopupTab(tab) {
    const normalized = normalizePopupTab(tab);
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { [STORAGE_KEYS.popupLastTab]: normalized },
        resolve,
      );
    });
  }

  // Remembering the page number could be introduced.
  async function applyCurrentTab(nextTab) {
    stateStore.setCurrentTab(normalizePopupTab(nextTab));
    stateStore.setCurrentPage(1);
    await storeLastPopupTab(state.currentTab);
  }

  async function resolveInitialTab(defaultTabSetting) {
    if (defaultTabSetting === "latest") {
      return getStoredLastPopupTab();
    }
    return normalizePopupTab(defaultTabSetting);
  }

  return {
    applyCurrentTab,
    normalizePopupTab,
    resolveInitialTab,
  };
}
