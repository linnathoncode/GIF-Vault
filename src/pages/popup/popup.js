import { idbClear } from "../../lib/db.js";
import {
  STORAGE_KEYS,
  ICONS,
  POPUP_MENU,
  POPUP_BOOT,
} from "../../lib/settings.js";
import {
  getRuntimeConfig,
  normalizeRuntimeConfig,
} from "../../lib/runtime-config.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import { isValidUrl, originPatternFromUrl } from "../../lib/ui.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setToolbarIcon,
} from "../../lib/theme.js";
import {
  restoreInactiveImportState,
  shouldClearProgressVisualsOnStorageClear,
} from "./popup-import-state.js";
import { createPopupGridController } from "./popup-grid.js";
import { createPopupStatusController } from "./popup-status.js";

const refs = {
  brandLogo: document.getElementById("brandLogo"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  countEl: document.getElementById("count"),
  grid: document.getElementById("grid"),
  hoverPreviewEl: document.getElementById("hoverPreview"),
  hoverPreviewImgEl: document.getElementById("hoverPreviewImg"),
  importBtn: document.getElementById("importBtn"),
  importBtnIcon: document.getElementById("importBtnIcon"),
  importBtnLabel: document.getElementById("importBtnLabel"),
  importInput: document.getElementById("importInput"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  openLogsBtn: document.getElementById("openLogsBtn"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  pageIndicator: document.getElementById("pageIndicator"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  progressBarEl: document.getElementById("progressBar"),
  progressLabelEl: document.getElementById("progressLabel"),
  progressTrackEl: document.getElementById("progressTrack"),
  statusTextEl: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  statusEl: document.getElementById("status"),
  tabAllBtn: document.getElementById("tabAllBtn"),
  tabFavoritesBtn: document.getElementById("tabFavoritesBtn"),
  themeToggleIcon: document.getElementById("themeToggleIcon"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
};

const state = {
  activeImportRequestId: "",
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
let localeApplyVersion = 0;
const INIT_STEP_TIMEOUT_MS = POPUP_BOOT.initStepTimeoutMs;
const QUERY_STATUS_MAX_LENGTH = POPUP_BOOT.statusQueryMaxLength;
const FALLBACK_POPUP_TAB = POPUP_BOOT.fallbackTab;
const INTERACTIVE_REFS = [
  "clearAllBtn",
  "importBtn",
  "importInput",
  "nextPageBtn",
  "openLogsBtn",
  "openOptionsBtn",
  "prevPageBtn",
  "searchInput",
  "tabAllBtn",
  "tabFavoritesBtn",
  "themeToggleBtn",
];

function isTrustedRuntimeSender(sender) {
  return sender?.id === chrome.runtime.id;
}

function isRuntimeMessage(message) {
  return (
    Boolean(message) && typeof message === "object" && !Array.isArray(message)
  );
}

function isVaultUpdatedMessage(message) {
  if (!isRuntimeMessage(message) || message.type !== "VAULT_UPDATED") {
    return false;
  }
  return !("itemId" in message) || typeof message.itemId === "string";
}

function isImportProgressMessage(message) {
  if (!isRuntimeMessage(message) || message.type !== "IMPORT_PROGRESS") {
    return false;
  }

  if ("requestId" in message && typeof message.requestId !== "string") {
    return false;
  }
  if (typeof message.text !== "string" || typeof message.kind !== "string") {
    return false;
  }
  if ("phase" in message && typeof message.phase !== "string") {
    return false;
  }
  if ("active" in message && typeof message.active !== "boolean") {
    return false;
  }

  return true;
}

function getSafeStatusQueryText(rawStatus) {
  const status = String(rawStatus || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!status || status.length > QUERY_STATUS_MAX_LENGTH) {
    return "";
  }
  return status;
}

function normalizePopupTab(value, fallback = FALLBACK_POPUP_TAB) {
  return value === "favorites"
    ? "favorites"
    : value === "all"
      ? "all"
      : fallback;
}

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

async function applyCurrentTab(nextTab) {
  state.currentTab = normalizePopupTab(nextTab);
  state.currentPage = 1;
  await storeLastPopupTab(state.currentTab);
}

async function resolveInitialTab(defaultTabSetting) {
  if (defaultTabSetting === "latest") {
    return getStoredLastPopupTab();
  }
  return normalizePopupTab(defaultTabSetting);
}

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

function getPopupMenuConfig() {
  return state.popupMenuConfig;
}

function setInteractiveEnabled(enabled) {
  const isEnabled = Boolean(enabled);
  state.isBootLoading = !isEnabled;
  document.body.classList.toggle("boot-loading", !isEnabled);
  refs.grid.setAttribute("aria-busy", isEnabled ? "false" : "true");

  for (const key of INTERACTIVE_REFS) {
    const element = refs[key];
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement
    ) {
      element.disabled = !isEnabled;
    }
  }
}

function showBootLoadingState() {
  setInteractiveEnabled(false);
  state.activeImportRequestId = "";
  state.currentImportState = null;
  statusController.clearTransientStatus();
  statusController.setStatus(UI_MESSAGES.popup.initializingDetail);
  statusController.setProgressState({
    text: UI_MESSAGES.popup.initializing,
    kind: "info",
    phase: UI_MESSAGES.import.phaseBoot,
    active: true,
  });
  refs.countEl.textContent = UI_MESSAGES.popup.initializing;
}

function clearBootLoadingUiIfPresent() {
  statusController.setProgressState(null);
  if (refs.statusTextEl?.textContent === UI_MESSAGES.popup.initializingDetail) {
    statusController.setStatus("");
  }
}

function isBootLoading() {
  return state.isBootLoading;
}

function runWhenInteractive(handler) {
  return (...args) => {
    if (isBootLoading()) {
      return;
    }
    return handler(...args);
  };
}

const statusController = createPopupStatusController({
  refs,
  state,
  getPopupMenuConfig,
});

const gridController = createPopupGridController({
  refs,
  state,
  getPopupMenuConfig,
  showTransientStatus: statusController.showTransientStatus,
});

function syncImportUiState() {
  const hasActiveImport = Boolean(state.currentImportState?.active);
  statusController.syncImportActionButton();
  refs.importInput.disabled = isBootLoading() || hasActiveImport;
}

// Import flow and permission handoff.
async function terminateImport() {
  const requestId =
    state.activeImportRequestId || state.currentImportState?.requestId || "";
  if (!requestId) {
    statusController.showTransientStatus(
      UI_MESSAGES.popup.noActiveImportToTerminate,
      "error",
    );
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TERMINATE_IMPORT",
      requestId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || UI_MESSAGES.popup.terminateFailed);
    }
    statusController.showTransientStatus(
      UI_MESSAGES.popup.importTerminationRequested,
      "ok",
    );
    await clearStoredImportStatePreservingUi();
  } catch (error) {
    statusController.showTransientStatus(
      error?.message || UI_MESSAGES.popup.terminateFailed,
      "error",
    );
  }
}

async function importUrl(rawUrl) {
  if (state.currentImportState?.active || state.activeImportRequestId) {
    statusController.showTransientStatus(
      UI_MESSAGES.popup.importAlreadyRunning,
      "error",
    );
    syncImportUiState();
    return;
  }

  statusController.clearTransientStatus();
  const url = String(rawUrl || "").trim();
  if (!url) {
    statusController.setStatus(UI_MESSAGES.popup.pasteUrlFirst);
    return;
  }
  if (!isValidUrl(url)) {
    statusController.setImportErrorState(UI_MESSAGES.popup.enterValidUrl);
    return;
  }

  const requestId = crypto.randomUUID();
  state.activeImportRequestId = requestId;
  state.currentImportState = {
    requestId,
    text: UI_MESSAGES.popup.startingImport,
    kind: "info",
    active: true,
  };
  syncImportUiState();
  statusController.setStatus(UI_MESSAGES.popup.startingImport);
  statusController.setProgressState({
    text: UI_MESSAGES.popup.startingImport,
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
      statusController.setProgressState(null);
      state.activeImportRequestId = "";
      state.currentImportState = null;
      syncImportUiState();
      await clearStoredImportStatePreservingUi();
      return;
    }
  } catch (error) {
    statusController.setImportErrorState(
      error?.message || UI_MESSAGES.popup.importFailed,
    );
    state.activeImportRequestId = "";
    await clearStoredImportStatePreservingUi();
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
      const importError = new Error(
        response?.error || UI_MESSAGES.popup.importFailed,
      );
      importError.code = String(response?.errorCode || "");
      throw importError;
    }

    refs.importInput.value = "";
    const importedCount = Number(response.result?.importedCount) || 1;
    const convertedCount = Number(response.result?.convertedCount) || 0;
    const successMessage = buildImportSuccessMessage(
      url,
      importedCount,
      convertedCount,
    );
    statusController.setImportSuccessState(successMessage);
    state.activeImportRequestId = "";
    await clearStoredImportStatePreservingUi();
    await gridController.render();
  } catch (error) {
    if (
      String(error?.code || "") === "HOST_ACCESS_REQUIRED" ||
      String(error?.message || "") === UI_MESSAGES.import.hostAccessRequired
    ) {
      await openPermissionAssist(url, "", []);
      statusController.setProgressState(null);
      state.activeImportRequestId = "";
      state.currentImportState = null;
      syncImportUiState();
      await clearStoredImportStatePreservingUi();
      return;
    }
    statusController.setImportErrorState(
      error?.message || UI_MESSAGES.popup.importFailed,
    );
    state.activeImportRequestId = "";
    await clearStoredImportStatePreservingUi();
    await safeLog("popup", "Import failed in popup", {
      error: error?.message || "unknown",
    });
  }
}

function isTweetUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).host.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  } catch {
    return false;
  }
}

function buildImportSuccessMessage(sourceUrl, importedCount, convertedCount) {
  const parts = [];
  if (importedCount > 1 && isTweetUrl(sourceUrl)) {
    parts.push(UI_MESSAGES.popup.successTweetMany(importedCount));
  }

  if (importedCount > 1) {
    parts.push(UI_MESSAGES.popup.successImportedMany(importedCount));
  } else {
    parts.push(UI_MESSAGES.popup.successImportedSingle);
  }

  if (convertedCount > 1) {
    parts.push(UI_MESSAGES.popup.successConvertedMany(convertedCount));
  } else if (convertedCount === 1 && importedCount > 1) {
    parts.push(UI_MESSAGES.popup.successConvertedSingleInBatch);
  } else if (convertedCount === 1) {
    parts.push(UI_MESSAGES.popup.successConvertedSingle);
  }

  return parts.join(" ");
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
    chrome.runtime.getURL("pages/assist/permission-assist.html"),
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

// Popup bootstrap, theme, and storage sync.
function applyImportAssistFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const importUrlFromQuery = params.get("importUrl") || "";
  const status = getSafeStatusQueryText(params.get("status"));
  if (importUrlFromQuery && !refs.importInput.value) {
    refs.importInput.value = importUrlFromQuery;
  }
  if (status) {
    statusController.setStatus(status);
  }
}

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  if (refs.themeToggleIcon) {
    const themeIcon =
      theme === "dark" ? "icon-theme-light.svg" : "icon-theme-moon.svg";
    refs.themeToggleIcon.src = `../../assets/shared/${themeIcon}`;
  }
  void setToolbarIcon(theme);
  if (refs.brandLogo) {
    const oppositeTheme = theme === "dark" ? "light" : "dark";
    refs.brandLogo.src = `../../${ICONS[oppositeTheme]["128"]}`;
  }
  state.themeMode = theme;
  gridController.updateEmptyStateMascotForTheme(theme);
}

async function applyLocale(localeHint = "") {
  const applyVersion = ++localeApplyVersion;
  await initializeI18n(
    localeHint
      ? {
          localeHint,
          useStoredLocale: false,
          persistDetectedLocale: false,
        }
      : {},
  );
  if (applyVersion !== localeApplyVersion) {
    return;
  }
  applyStaticI18n();
}

function invalidatePendingLocaleApply() {
  localeApplyVersion += 1;
}

function withTimeout(promise, timeoutMs, code = "TIMEOUT") {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => {
        reject(new Error(code));
      },
      Math.max(0, timeoutMs),
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
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

async function clearStoredImportStatePreservingUi() {
  state.suppressNextImportStateClearUiReset = true;
  await clearStoredImportState();
}

refs.importBtn.addEventListener(
  "click",
  runWhenInteractive(() => {
    gridController.clearSelections();
    if (state.currentImportState?.active) {
      void terminateImport();
      return;
    }
    void importUrl(refs.importInput.value);
  }),
);
refs.importInput.addEventListener(
  "click",
  runWhenInteractive(() => {
    gridController.clearSelections();
  }),
);
refs.importInput.addEventListener(
  "focus",
  runWhenInteractive(() => {
    gridController.clearSelections();
  }),
);
refs.importInput.addEventListener(
  "keydown",
  runWhenInteractive((event) => {
    gridController.clearSelections();
    if (event.key === "Enter") {
      void importUrl(refs.importInput.value);
    }
  }),
);
refs.grid.addEventListener("scroll", gridController.hideHoverPreview);
window.addEventListener("blur", gridController.hideHoverPreview);

refs.clearAllBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    const confirmed = window.confirm(UI_MESSAGES.popup.clearVaultConfirm);
    if (!confirmed) {
      return;
    }
    await idbClear();
    gridController.cleanupObjectUrls();
    statusController.showTransientStatus(UI_MESSAGES.popup.vaultCleared, "ok");
    await safeLog("popup", "Vault cleared");
    await gridController.render();
  }),
);

window.addEventListener("unload", gridController.cleanupObjectUrls);
refs.openOptionsBtn.addEventListener(
  "click",
  runWhenInteractive(() => {
    if (typeof chrome.runtime.openOptionsPage === "function") {
      void chrome.runtime.openOptionsPage();
      return;
    }
    const url = chrome.runtime.getURL("pages/options/options.html");
    void chrome.tabs.create({ url });
  }),
);
refs.openLogsBtn.addEventListener(
  "click",
  runWhenInteractive(() => {
    const url = chrome.runtime.getURL("pages/logs/logs.html");
    void chrome.tabs.create({ url });
  }),
);
refs.themeToggleBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    state.themeMode = state.themeMode === "dark" ? "light" : "dark";
    applyTheme(state.themeMode);
    await setThemeMode(state.themeMode);
  }),
);
refs.tabAllBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    gridController.clearSelections();
    await applyCurrentTab("all");
    await gridController.render();
  }),
);
refs.tabFavoritesBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    gridController.clearSelections();
    await applyCurrentTab("favorites");
    await gridController.render();
  }),
);
refs.searchInput.addEventListener(
  "click",
  runWhenInteractive(() => {
    gridController.clearSelections();
  }),
);
refs.searchInput.addEventListener(
  "focus",
  runWhenInteractive(() => {
    gridController.clearSelections();
  }),
);
refs.searchInput.addEventListener(
  "input",
  runWhenInteractive(async () => {
    gridController.clearSelections();
    state.searchTerm = refs.searchInput.value || "";
    state.currentPage = 1;
    await gridController.render();
  }),
);
refs.prevPageBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    state.currentPage = Math.max(1, state.currentPage - 1);
    await gridController.render();
  }),
);
refs.nextPageBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    state.currentPage += 1;
    await gridController.render();
  }),
);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isTrustedRuntimeSender(sender) || !isRuntimeMessage(message)) {
    return;
  }

  if (isVaultUpdatedMessage(message)) {
    if (isBootLoading()) {
      return;
    }
    void gridController.render();
    return;
  }
  if (!isImportProgressMessage(message)) {
    return;
  }
  if (
    state.activeImportRequestId &&
    message.requestId !== state.activeImportRequestId
  ) {
    return;
  }
  statusController.applyImportState(message);
  syncImportUiState();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[STORAGE_KEYS.runtimeConfig]?.newValue) {
    const previousDefaultTab = state.popupMenuConfig.defaultTab;
    const normalized = normalizeRuntimeConfig(
      changes[STORAGE_KEYS.runtimeConfig].newValue,
    );
    state.popupMenuConfig = {
      ...normalized.popupMenu,
      importProgressPercent: {
        ...normalized.popupMenu.importProgressPercent,
      },
    };
    if (previousDefaultTab !== state.popupMenuConfig.defaultTab) {
      void (async () => {
        state.currentTab = await resolveInitialTab(
          state.popupMenuConfig.defaultTab,
        );
        state.currentPage = 1;
        if (!isBootLoading()) {
          await gridController.render();
        }
      })();
    }
    if (!state.popupMenuConfig.hoverPreviewEnabled) {
      gridController.hideHoverPreview();
    }
    if (previousDefaultTab === state.popupMenuConfig.defaultTab) {
      if (!isBootLoading()) {
        void gridController.render();
      }
    }
  }

  if (
    changes[STORAGE_KEYS.importState]?.newValue ||
    changes[STORAGE_KEYS.importState]?.oldValue
  ) {
    const nextState = changes[STORAGE_KEYS.importState].newValue || null;
    const prevState = changes[STORAGE_KEYS.importState].oldValue || null;
    if (nextState) {
      statusController.applyImportState(nextState);
    } else {
      state.currentImportState = null;
      if (isBootLoading()) {
        syncImportUiState();
        return;
      }
      const shouldClearProgress = shouldClearProgressVisualsOnStorageClear({
        hasTransientStatus: statusController.hasTransientStatus(),
        suppressUiReset: state.suppressNextImportStateClearUiReset,
      });
      state.suppressNextImportStateClearUiReset = false;
      if (shouldClearProgress) {
        statusController.setProgressState(null);
      }
    }
    syncImportUiState();
    if (
      (prevState?.active || false) &&
      !nextState?.active &&
      !isBootLoading()
    ) {
      void gridController.render();
    }
  }

  if (changes[STORAGE_KEYS.themeMode]) {
    applyTheme(changes[STORAGE_KEYS.themeMode].newValue);
  }

  if (changes[STORAGE_KEYS.locale]?.newValue) {
    const nextLocale = String(
      changes[STORAGE_KEYS.locale].newValue || "",
    ).trim();
    void (async () => {
      await applyLocale(nextLocale);
      if (isBootLoading()) {
        showBootLoadingState();
        return;
      }
      syncImportUiState();
      await gridController.render();
    })();
  }
});

async function init() {
  // Enter guarded startup mode before any async work.
  showBootLoadingState();

  try {
    // Apply locale first so startup copy and labels are in the right language.
    await withTimeout(
      applyLocale(),
      INIT_STEP_TIMEOUT_MS,
      "LOCALE_INIT_TIMEOUT",
    ).catch(() => {
      // Prevent a late locale init from rewriting labels after primary render.
      invalidatePendingLocaleApply();
    });
    // Repaint boot text after locale init because localized labels can
    // overwrite startup copy; this reapplies the loading message in the active locale.
    showBootLoadingState();

    // Load runtime popup config and apply UI behavior flags.
    const runtimeConfig = await withTimeout(
      getRuntimeConfig(),
      INIT_STEP_TIMEOUT_MS,
      "RUNTIME_CONFIG_TIMEOUT",
    ).catch(() => normalizeRuntimeConfig({}));
    state.popupMenuConfig = {
      ...runtimeConfig.popupMenu,
      importProgressPercent: {
        ...runtimeConfig.popupMenu.importProgressPercent,
      },
    };
    if (!state.popupMenuConfig.hoverPreviewEnabled) {
      gridController.hideHoverPreview();
    }

    // Resolve persisted UI state (tab + theme) and query-based assist hints.
    state.currentTab = await resolveInitialTab(
      state.popupMenuConfig.defaultTab,
    );
    const initialTheme = await withTimeout(
      getThemeMode(),
      INIT_STEP_TIMEOUT_MS,
      "THEME_LOAD_TIMEOUT",
    ).catch(() => "light");
    applyTheme(initialTheme);
    applyImportAssistFromQuery();

    // Restore import progress/state from storage (if present).
    const importState = await withTimeout(
      getImportState(),
      INIT_STEP_TIMEOUT_MS,
      "IMPORT_STATE_TIMEOUT",
    ).catch(() => null);
    if (importState?.text) {
      if (importState.active) {
        statusController.applyImportState(importState);
      } else {
        state.currentImportState = null;
        await restoreInactiveImportState({
          importState,
          statusController,
          clearStoredImportState,
        });
      }
    } else {
      state.currentImportState = importState || null;
    }

    // First full render, then unlock interactions.
    syncImportUiState();
    await gridController.render();
    if (!state.currentImportState?.text) {
      clearBootLoadingUiIfPresent();
    }
    setInteractiveEnabled(true);
    syncImportUiState();
  } catch (error) {
    // Fail-safe path keeps interactions locked and surfaces a clear status.
    setInteractiveEnabled(false);
    statusController.setImportErrorState(
      UI_MESSAGES.popup.initializationFailed,
    );
    refs.countEl.textContent = UI_MESSAGES.popup.initializationFailed;
    await safeLog("popup", "Popup initialization failed", {
      error: error?.message || "unknown",
    });
  }
}

init();
