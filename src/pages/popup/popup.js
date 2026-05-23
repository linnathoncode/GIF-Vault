import { idbClear } from "../../lib/db.js";
import { STORAGE_KEYS, BRAND_LOGOS, POPUP_BOOT } from "../../lib/settings.js";
import {
  getRuntimeConfig,
  normalizeRuntimeConfig,
} from "../../lib/runtime-config.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import {
  MESSAGE_TYPES,
  isRuntimeMessage,
} from "../../lib/protocol.js";
import { withTimeout } from "../../lib/async.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setToolbarIcon,
} from "../../lib/theme.js";
import {
  restoreInactiveImportState,
  shouldClearProgressVisualsOnStorageClear,
} from "./popup/import-state.js";
import { createPopupState } from "./popup/state.js";
import { createPopupGridController } from "./popup/grid.js";
import { createPopupStatusController } from "./popup/status.js";
import { createPopupImportController } from "./popup/import-flow.js";
import { createPopupTabController } from "./popup/tab.js";

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
  localFileInput: document.getElementById("localFileInput"),
  localImportBtn: document.getElementById("localImportBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  openLogsBtn: document.getElementById("openLogsBtn"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  pageIndicator: document.getElementById("pageIndicator"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  progressBarEl: document.getElementById("progressBar"),
  progressLabelEl: document.getElementById("progressLabel"),
  progressTrackEl: document.getElementById("progressTrack"),
  selectionCancelBtn: document.getElementById("selectionCancelBtn"),
  selectedCountEl: document.getElementById("selectedCount"),
  statusTextEl: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  statusEl: document.getElementById("status"),
  tabAllBtn: document.getElementById("tabAllBtn"),
  tabFavoritesBtn: document.getElementById("tabFavoritesBtn"),
  themeToggleIcon: document.getElementById("themeToggleIcon"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
};

const stateStore = createPopupState();
const { state } = stateStore;
let localeApplyVersion = 0;
let dragStartedInPopup = false;
const INIT_STEP_TIMEOUT_MS = POPUP_BOOT.initStepTimeoutMs;
const INTERACTIVE_REFS = [
  "clearAllBtn",
  "importBtn",
  "importInput",
  "localFileInput",
  "localImportBtn",
  "nextPageBtn",
  "openLogsBtn",
  "openOptionsBtn",
  "prevPageBtn",
  "selectionCancelBtn",
  "searchInput",
  "tabAllBtn",
  "tabFavoritesBtn",
  "themeToggleBtn",
];

function isTrustedRuntimeSender(sender) {
  return sender?.id === chrome.runtime.id;
}

function isVaultUpdatedMessage(message) {
  if (
    !isRuntimeMessage(message) ||
    message.type !== MESSAGE_TYPES.vaultUpdated
  ) {
    return false;
  }
  return !("itemId" in message) || typeof message.itemId === "string";
}

function isImportProgressMessage(message) {
  if (
    !isRuntimeMessage(message) ||
    message.type !== MESSAGE_TYPES.importProgress
  ) {
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
  if ("messageKey" in message && typeof message.messageKey !== "string") {
    return false;
  }
  if ("messageArgs" in message && !Array.isArray(message.messageArgs)) {
    return false;
  }

  return true;
}

function resolveImportProgressText(importState) {
  const messageKey = String(importState?.messageKey || "").trim();
  if (!messageKey) {
    return String(importState?.text || "");
  }
  const template = UI_MESSAGES.import?.[messageKey];
  const messageArgs = Array.isArray(importState?.messageArgs)
    ? importState.messageArgs
    : [];
  if (typeof template === "function") {
    try {
      return String(template(...messageArgs));
    } catch {
      return String(importState?.text || "");
    }
  }
  if (typeof template === "string") {
    return template;
  }
  return String(importState?.text || "");
}

function localizeImportState(importState) {
  if (!importState || typeof importState !== "object") {
    return importState;
  }
  return {
    ...importState,
    text: resolveImportProgressText(importState),
  };
}

function normalizedMessageArgs(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? ""));
}

function areImportStatesEquivalent(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  const aArgs = normalizedMessageArgs(a.messageArgs);
  const bArgs = normalizedMessageArgs(b.messageArgs);
  return (
    String(a.requestId || "") === String(b.requestId || "") &&
    String(a.text || "") === String(b.text || "") &&
    String(a.kind || "") === String(b.kind || "") &&
    String(a.phase || "") === String(b.phase || "") &&
    Boolean(a.active) === Boolean(b.active) &&
    String(a.messageKey || "") === String(b.messageKey || "") &&
    aArgs.length === bArgs.length &&
    aArgs.every((arg, index) => arg === bArgs[index])
  );
}

function getPopupMenuConfig() {
  return state.popupMenuConfig;
}

function setInteractiveEnabled(enabled) {
  const isEnabled = Boolean(enabled);
  stateStore.setBootLoading(!isEnabled);
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
  stateStore.resetActiveImportSession();
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

function runWhenInteractive(handler) {
  return (...args) => {
    if (state.isBootLoading) {
      return;
    }
    return handler(...args);
  };
}

function isEditableEventTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function isFileDragEvent(event) {
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes("Files");
}

function getDroppedFiles(event) {
  const files = Array.from(event?.dataTransfer?.files || []);
  return files.filter((file) => file instanceof Blob);
}

function normalizeDroppedSourceUrl(rawValue) {
  const candidate = String(rawValue || "").trim();
  if (!candidate) {
    return "";
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function getDroppedSourceUrl(event) {
  const uriListRaw = String(event?.dataTransfer?.getData("text/uri-list") || "");
  const firstUri = uriListRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  const normalizedUriList = normalizeDroppedSourceUrl(firstUri);
  if (normalizedUriList) {
    return normalizedUriList;
  }

  const plainTextRaw = String(event?.dataTransfer?.getData("text/plain") || "").trim();
  return normalizeDroppedSourceUrl(plainTextRaw);
}

function shouldIgnoreFileDrop(event) {
  return (
    dragStartedInPopup ||
    state.isBootLoading ||
    state.isImportTerminationPending ||
    state.currentImportState?.active ||
    !isFileDragEvent(event)
  );
}

function syncSelectionUi(selectedCount = 0) {
  const hasSelections = selectedCount > 0;
  if (refs.selectedCountEl && "hidden" in refs.selectedCountEl) {
    refs.selectedCountEl.hidden = !hasSelections;
    refs.selectedCountEl.textContent = hasSelections
      ? UI_MESSAGES.grid.selectedCount(selectedCount)
      : "";
  }
  if (refs.selectionCancelBtn && "hidden" in refs.selectionCancelBtn) {
    refs.selectionCancelBtn.hidden = !hasSelections;
  }
}

const statusController = createPopupStatusController({
  refs,
  getState: () => state,
  applyImportStateToStore: stateStore.applyImportState,
  setImportState: stateStore.setImportState,
  getPopupMenuConfig,
});

const gridController = createPopupGridController({
  refs,
  state,
  getPopupMenuConfig,
  showTransientStatus: statusController.showTransientStatus,
  onSelectionChange: syncSelectionUi,
});

function syncImportUiState() {
  const hasActiveImport = Boolean(state.currentImportState?.active);
  const isGloballyLocked = state.isBootLoading;
  document.body.classList.toggle("import-active", hasActiveImport);
  refs.grid.setAttribute(
    "aria-busy",
    state.isBootLoading || hasActiveImport ? "true" : "false",
  );

  for (const key of INTERACTIVE_REFS) {
    const element = refs[key];
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLButtonElement
    ) {
      element.disabled = isGloballyLocked;
    }
  }

  statusController.syncImportActionButton();
  refs.importBtn.disabled = isGloballyLocked;
  refs.importInput.disabled =
    state.isBootLoading || hasActiveImport;
  if (refs.localImportBtn) {
    refs.localImportBtn.disabled =
      state.isBootLoading || hasActiveImport;
  }
  if (refs.localFileInput) {
    refs.localFileInput.disabled =
      state.isBootLoading || hasActiveImport;
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
    refs.brandLogo.src = `../../${BRAND_LOGOS[oppositeTheme]}`;
  }
  stateStore.setThemeMode(theme);
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
  if (state.currentImportState?.text || state.currentImportState?.messageKey) {
    statusController.applyImportState(localizeImportState(state.currentImportState));
  }
}

function invalidatePendingLocaleApply() {
  localeApplyVersion += 1;
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
  stateStore.setSuppressImportStateUiReset(true);
  await clearStoredImportState();
}

const tabController = createPopupTabController({
  state,
  stateStore,
});

const importController = createPopupImportController({
  refs,
  state,
  stateStore,
  statusController,
  gridController,
  syncImportUiState,
  clearStoredImportStatePreservingUi,
});

refs.importBtn.addEventListener(
  "click",
  runWhenInteractive(() => {
    gridController.clearSelections();
    if (state.currentImportState?.active) {
      void importController.terminateImport();
      return;
    }
    void importController.importUrl(refs.importInput.value);
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
      void importController.importUrl(refs.importInput.value);
    }
  }),
);
if (refs.localImportBtn && refs.localFileInput) {
  refs.localImportBtn.addEventListener(
    "click",
    runWhenInteractive(() => {
      gridController.clearSelections();
      importController.openLocalFilePicker();
    }),
  );
  refs.localFileInput.addEventListener(
    "change",
    runWhenInteractive(() => {
      gridController.clearSelections();
      const files = Array.from(refs.localFileInput.files || []);
      void importController.importFiles(files);
    }),
  );
}

window.addEventListener("dragstart", (event) => {
  dragStartedInPopup = event.target instanceof Node && document.body.contains(event.target);
});

window.addEventListener("dragend", () => {
  dragStartedInPopup = false;
  document.body.classList.remove("drag-file-active");
});

window.addEventListener("dragenter", (event) => {
  if (isFileDragEvent(event)) {
    event.preventDefault();
  }
  if (shouldIgnoreFileDrop(event)) {
    return;
  }
  document.body.classList.add("drag-file-active");
});

window.addEventListener("dragover", (event) => {
  if (isFileDragEvent(event)) {
    event.preventDefault();
  }
  if (shouldIgnoreFileDrop(event)) {
    return;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  document.body.classList.add("drag-file-active");
});

window.addEventListener("dragleave", (event) => {
  const toElement = event.relatedTarget;
  if (toElement instanceof Node && document.body.contains(toElement)) {
    return;
  }
  document.body.classList.remove("drag-file-active");
});

window.addEventListener("drop", (event) => {
  if (isFileDragEvent(event)) {
    event.preventDefault();
  }
  const startedInPopup = dragStartedInPopup;
  dragStartedInPopup = false;
  document.body.classList.remove("drag-file-active");
  if (startedInPopup || shouldIgnoreFileDrop(event)) {
    return;
  }
  const files = getDroppedFiles(event);
  if (files.length === 0) {
    return;
  }
  const sourceUrlHint = getDroppedSourceUrl(event);
  gridController.clearSelections();
  void importController.importFiles(files, { sourceUrlHint });
});

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
    stateStore.setThemeMode(state.themeMode === "dark" ? "light" : "dark");
    applyTheme(state.themeMode);
    await setThemeMode(state.themeMode);
  }),
);
refs.tabAllBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    gridController.clearSelections();
    await tabController.applyCurrentTab("all");
    await gridController.render();
  }),
);

if (refs.selectionCancelBtn) {
  refs.selectionCancelBtn.addEventListener(
    "click",
    runWhenInteractive(() => {
      gridController.clearSelections();
    }),
  );
}
refs.tabFavoritesBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    gridController.clearSelections();
    await tabController.applyCurrentTab("favorites");
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
    stateStore.setSearchTerm(refs.searchInput.value || "");
    stateStore.setCurrentPage(1);
    await gridController.render();
  }),
);
refs.prevPageBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    stateStore.setCurrentPage(Math.max(1, state.currentPage - 1));
    await gridController.render();
  }),
);
refs.nextPageBtn.addEventListener(
  "click",
  runWhenInteractive(async () => {
    stateStore.setCurrentPage(state.currentPage + 1);
    await gridController.render();
  }),
);
window.addEventListener(
  "keydown",
  runWhenInteractive(async (event) => {
    if (event.defaultPrevented || event.repeat) {
      return;
    }
    if (
      event.key !== "Delete" &&
      event.key !== "Backspace"
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isEditableEventTarget(event.target)) {
      return;
    }
    const selectedCount = gridController.getSelectedCount();
    if (selectedCount <= 0) {
      return;
    }

    event.preventDefault();
    const confirmText = selectedCount > 1
      ? UI_MESSAGES.grid.confirmDeleteTitleMany(selectedCount)
      : UI_MESSAGES.grid.confirmDeleteTitleSingle;
    const confirmed = window.confirm(`${confirmText}?`);
    if (!confirmed) {
      return;
    }
    await gridController.deleteSelectedItems();
  }),
);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isTrustedRuntimeSender(sender) || !isRuntimeMessage(message)) {
    return;
  }

  if (isVaultUpdatedMessage(message)) {
    if (state.isBootLoading) {
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
  if (
    state.isImportTerminationPending &&
    !message.active
  ) {
    const requestId = String(message.requestId || "").trim();
    if (
      !state.importTerminationRequestId ||
      !requestId ||
      requestId === state.importTerminationRequestId
    ) {
      stateStore.clearImportTerminationPending();
    }
  }
  const localizedMessage = localizeImportState(message);
  if (areImportStatesEquivalent(localizedMessage, state.currentImportState)) {
    return;
  }
  statusController.applyImportState(localizedMessage);
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
    stateStore.setPopupMenuConfig({
      ...normalized.popupMenu,
      importProgressPercent: {
        ...normalized.popupMenu.importProgressPercent,
      },
    });
    if (previousDefaultTab !== state.popupMenuConfig.defaultTab) {
      void (async () => {
        stateStore.setCurrentTab(
          await tabController.resolveInitialTab(state.popupMenuConfig.defaultTab),
        );
        stateStore.setCurrentPage(1);
        if (!state.isBootLoading) {
          await gridController.render();
        }
      })();
    }
    if (!state.popupMenuConfig.hoverPreviewEnabled) {
      gridController.hideHoverPreview();
    }
    if (previousDefaultTab === state.popupMenuConfig.defaultTab) {
      if (!state.isBootLoading) {
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
    let didMutateImportUiState = false;
    if (
      state.isImportTerminationPending &&
      !nextState?.active
    ) {
      const requestId = String(nextState?.requestId || "").trim();
      if (
        !state.importTerminationRequestId ||
        !requestId ||
        requestId === state.importTerminationRequestId
      ) {
        stateStore.clearImportTerminationPending();
        didMutateImportUiState = true;
      }
    }
    if (nextState) {
      const localizedNextState = localizeImportState(nextState);
      if (
        !areImportStatesEquivalent(localizedNextState, state.currentImportState)
      ) {
        statusController.applyImportState(localizedNextState);
        didMutateImportUiState = true;
      }
    } else {
      stateStore.setImportState(null);
      stateStore.setActiveImportRequestId("");
      stateStore.clearImportTerminationPending();
      didMutateImportUiState = true;
      if (state.isBootLoading) {
        syncImportUiState();
        return;
      }
      const shouldClearProgress = shouldClearProgressVisualsOnStorageClear({
        hasTransientStatus: statusController.hasTransientStatus(),
        suppressUiReset: state.suppressNextImportStateClearUiReset,
      });
      stateStore.setSuppressImportStateUiReset(false);
      if (shouldClearProgress) {
        statusController.setProgressState(null);
      }
    }
    if (didMutateImportUiState) {
      syncImportUiState();
    }
    if (
      (prevState?.active || false) &&
      !nextState?.active &&
      !state.isBootLoading
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
      if (state.isBootLoading) {
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
    stateStore.setPopupMenuConfig({
      ...runtimeConfig.popupMenu,
      importProgressPercent: {
        ...runtimeConfig.popupMenu.importProgressPercent,
      },
    });
    if (!state.popupMenuConfig.hoverPreviewEnabled) {
      gridController.hideHoverPreview();
    }

    // Resolve persisted UI state (tab + theme).
    stateStore.setCurrentTab(
      await tabController.resolveInitialTab(state.popupMenuConfig.defaultTab),
    );
    const initialTheme = await withTimeout(
      getThemeMode(),
      INIT_STEP_TIMEOUT_MS,
      "THEME_LOAD_TIMEOUT",
    ).catch(() => "light");
    applyTheme(initialTheme);
    // Restore import progress/state from storage (if present).
    const importState = await withTimeout(
      getImportState(),
      INIT_STEP_TIMEOUT_MS,
      "IMPORT_STATE_TIMEOUT",
    ).catch(() => null);
    if (importState?.text || importState?.messageKey) {
      const localizedImportState = localizeImportState(importState);
      if (importState.active) {
        statusController.applyImportState(localizedImportState);
      } else {
        stateStore.setImportState(null);
        await restoreInactiveImportState({
          importState: localizedImportState,
          statusController,
          clearStoredImportState,
        });
      }
    } else {
      stateStore.setImportState(importState || null);
    }

    // First full render, then unlock interactions.
    syncImportUiState();
    await gridController.render();
    syncSelectionUi(0);
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
