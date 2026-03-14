import { idbClear } from "../../lib/db.js";
import { STORAGE_KEYS, ICONS, POPUP_MENU } from "../../lib/settings.js";
import {
  getRuntimeConfig,
  normalizeRuntimeConfig,
} from "../../lib/runtime-config.js";
import { safeLog } from "../../lib/log.js";
import { isValidUrl, originPatternFromUrl } from "../../lib/ui.js";
import {
  applyDocumentTheme,
  getThemeMode,
  setThemeMode,
  setThemeToggleGlyph,
  setToolbarIcon,
} from "../../lib/theme.js";
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
  importInput: document.getElementById("importInput"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  openLogsBtn: document.getElementById("openLogsBtn"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  pageIndicator: document.getElementById("pageIndicator"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  progressBarEl: document.getElementById("progressBar"),
  progressLabelEl: document.getElementById("progressLabel"),
  progressTrackEl: document.getElementById("progressTrack"),
  searchInput: document.getElementById("searchInput"),
  statusEl: document.getElementById("status"),
  tabAllBtn: document.getElementById("tabAllBtn"),
  tabFavoritesBtn: document.getElementById("tabFavoritesBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
};

const state = {
  activeImportRequestId: "",
  currentImportState: null,
  currentPage: 1,
  currentTab: POPUP_MENU.defaultTab,
  pendingFocusRestore: null,
  popupMenuConfig: defaultPopupMenuConfig(),
  renderSequence: 0,
  searchTerm: "",
  themeMode: "light",
};

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

// Import flow and permission handoff.
async function terminateImport() {
  const requestId =
    state.activeImportRequestId || state.currentImportState?.requestId || "";
  if (!requestId) {
    statusController.showTransientStatus("No active import to terminate.", "error");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TERMINATE_IMPORT",
      requestId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Terminate failed");
    }
    statusController.showTransientStatus("Import termination requested.", "ok");
  } catch (error) {
    statusController.showTransientStatus(
      error?.message || "Terminate failed.",
      "error",
    );
  }
}

async function importUrl(rawUrl) {
  statusController.clearTransientStatus();
  const url = String(rawUrl || "").trim();
  if (!url) {
    statusController.setStatus("Paste a URL first.");
    return;
  }
  if (!isValidUrl(url)) {
    statusController.setImportErrorState("Please enter a valid URL.");
    return;
  }

  const requestId = crypto.randomUUID();
  state.activeImportRequestId = requestId;
  state.currentImportState = {
    requestId,
    text: "Starting import...",
    kind: "info",
    active: true,
  };
  statusController.syncImportActionButton();
  statusController.setStatus("Starting import...");
  statusController.setProgressState({
    text: "Starting import...",
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
      statusController.setStatus(
        "Additional site access is needed. Continue in the permission tab.",
      );
      statusController.setProgressState(null);
      state.activeImportRequestId = "";
      state.currentImportState = null;
      statusController.syncImportActionButton();
      return;
    }
  } catch (error) {
    statusController.setImportErrorState(error?.message || "Import failed");
    state.activeImportRequestId = "";
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
      throw new Error(response?.error || "Import failed");
    }

    refs.importInput.value = "";
    refs.importBtn.textContent = "Import";
    const convertedMessage = response.result?.converted ? " (converted)" : "";
    statusController.setImportSuccessState(
      `Imported successfully${convertedMessage}.`,
    );
    state.activeImportRequestId = "";
    await gridController.render();
  } catch (error) {
    if (String(error?.message || "").startsWith("Host access needed for ")) {
      await openPermissionAssist(url, "", []);
      statusController.setStatus(
        "Additional site access is needed. Continue in the permission tab.",
      );
      statusController.setProgressState(null);
      state.activeImportRequestId = "";
      state.currentImportState = null;
      statusController.syncImportActionButton();
      return;
    }
    statusController.setImportErrorState(error?.message || "Import failed");
    state.activeImportRequestId = "";
    await safeLog("popup", "Import failed in popup", {
      error: error?.message || "unknown",
    });
  }
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
  const assistUrl = new URL(chrome.runtime.getURL("pages/assist/permission-assist.html"));
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
  const status = params.get("status") || "";
  if (importUrlFromQuery && !refs.importInput.value) {
    refs.importInput.value = importUrlFromQuery;
  }
  if (status) {
    statusController.setStatus(status);
  }
}

function applyTheme(mode) {
  const theme = applyDocumentTheme(mode);
  setThemeToggleGlyph(refs.themeToggleBtn, theme);
  void setToolbarIcon(theme);
  if (refs.brandLogo) {
    const oppositeTheme = theme === "dark" ? "light" : "dark";
    refs.brandLogo.src = `../../${ICONS[oppositeTheme]["128"]}`;
  }
  state.themeMode = theme;
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

refs.importBtn.addEventListener("click", () => {
  if (state.currentImportState?.active) {
    void terminateImport();
    return;
  }
  void importUrl(refs.importInput.value);
});
refs.importInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void importUrl(refs.importInput.value);
  }
});
refs.grid.addEventListener("scroll", gridController.hideHoverPreview);
window.addEventListener("blur", gridController.hideHoverPreview);

refs.clearAllBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear all items from GIF Vault? This cannot be undone.",
  );
  if (!confirmed) {
    return;
  }
  await idbClear();
  gridController.cleanupObjectUrls();
  statusController.showTransientStatus("Vault cleared.", "ok");
  await safeLog("popup", "Vault cleared");
  await gridController.render();
});

window.addEventListener("unload", gridController.cleanupObjectUrls);
refs.openOptionsBtn.addEventListener("click", () => {
  if (typeof chrome.runtime.openOptionsPage === "function") {
    void chrome.runtime.openOptionsPage();
    return;
  }
  const url = chrome.runtime.getURL("pages/options/options.html");
  void chrome.tabs.create({ url });
});
refs.openLogsBtn.addEventListener("click", () => {
  const url = chrome.runtime.getURL("pages/logs/logs.html");
  void chrome.tabs.create({ url });
});
refs.themeToggleBtn.addEventListener("click", async () => {
  state.themeMode = state.themeMode === "dark" ? "light" : "dark";
  applyTheme(state.themeMode);
  await setThemeMode(state.themeMode);
});
refs.tabAllBtn.addEventListener("click", async () => {
  state.currentTab = "all";
  state.currentPage = 1;
  await gridController.render();
});
refs.tabFavoritesBtn.addEventListener("click", async () => {
  state.currentTab = "favorites";
  state.currentPage = 1;
  await gridController.render();
});
refs.searchInput.addEventListener("input", async () => {
  state.searchTerm = refs.searchInput.value || "";
  state.currentPage = 1;
  await gridController.render();
});
refs.prevPageBtn.addEventListener("click", async () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  await gridController.render();
});
refs.nextPageBtn.addEventListener("click", async () => {
  state.currentPage += 1;
  await gridController.render();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message) {
    return;
  }
  if (message.type === "VAULT_UPDATED") {
    void gridController.render();
    return;
  }
  if (message.type !== "IMPORT_PROGRESS") {
    return;
  }
  if (
    state.activeImportRequestId &&
    message.requestId !== state.activeImportRequestId
  ) {
    return;
  }
  statusController.applyImportState(message);
  statusController.syncImportActionButton();
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
      state.currentTab = state.popupMenuConfig.defaultTab;
      state.currentPage = 1;
    }
    if (!state.popupMenuConfig.hoverPreviewEnabled) {
      gridController.hideHoverPreview();
    }
    void gridController.render();
  }

  if (changes[STORAGE_KEYS.importState]?.newValue || changes[STORAGE_KEYS.importState]?.oldValue) {
    const nextState = changes[STORAGE_KEYS.importState].newValue || null;
    const prevState = changes[STORAGE_KEYS.importState].oldValue || null;
    if (nextState) {
      statusController.applyImportState(nextState);
    } else {
      state.currentImportState = null;
      if (!statusController.hasTransientStatus()) {
        statusController.setProgressState(null);
      }
    }
    statusController.syncImportActionButton();
    if ((prevState?.active || false) && !nextState?.active) {
      void gridController.render();
    }
  }

  if (changes[STORAGE_KEYS.themeMode]) {
    applyTheme(changes[STORAGE_KEYS.themeMode].newValue);
  }
});

async function init() {
  const runtimeConfig = await getRuntimeConfig();
  state.popupMenuConfig = {
    ...runtimeConfig.popupMenu,
    importProgressPercent: {
      ...runtimeConfig.popupMenu.importProgressPercent,
    },
  };
  if (!state.popupMenuConfig.hoverPreviewEnabled) {
    gridController.hideHoverPreview();
  }
  state.currentTab = state.popupMenuConfig.defaultTab;
  applyTheme(await getThemeMode());
  applyImportAssistFromQuery();

  const importState = await getImportState();
  if (importState?.text) {
    if (importState.active) {
      statusController.applyImportState(importState);
    } else {
      state.currentImportState = null;
      statusController.setProgressState(null);
      statusController.showTransientStatus(
        importState.text,
        importState.kind === "success" ? "ok" : importState.kind || "",
        2200,
        { preserveProgress: false, forceTemporary: true },
      );
      await clearStoredImportState();
    }
  } else {
    state.currentImportState = importState || null;
  }

  statusController.syncImportActionButton();
  await gridController.render();
}

init();
