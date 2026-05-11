const STORAGE_KEYS = {
  themeMode: "themeMode",
  locale: "locale",
  importState: "importState",
  runtimeConfig: "runtimeConfig",
  popupLastTab: "popupLastTab",
  instagramContextMedia: "instagramContextMedia",
};

const CONTEXT_MENU = {
  addToVaultId: "addToGifVault",
  addToVaultInstagramPageId: "addToGifVaultInstagramPage",
};

const OFFSCREEN = {
  url: "offscreen/offscreen.html",
};

const IMPORT_PIPELINE = {
  minDownloadSizeMb: 5,
  maxDownloadSizeMb: 64,
};

const DB = {
  name: "gifVaultDB",
  version: 3,
  mediaStore: "media",
  mediaBlobStore: "mediaBlobs",
  logStore: "logs",
  logMaxItems: 500,
};

const GIF_CONVERSION = {
  fps: 10,
  width: 360,
  maxColors: 96,
  maxDownloadSizeMb: 50,
};

const BADGE = {
  okColor: "#0f766e",
  errorColor: "#8b2635",
  okText: "+",
  errorText: "!",
  clearDelayMs: 3000,
};

const BRAND_LOGOS = {
  light: "assets/icons/brand/icon-light.svg",
  dark: "assets/icons/brand/icon-dark.svg",
};

const POPUP_MENU = {
  pageSize: 12,
  defaultTab: "all",
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  copyFeedbackResetDelayMs: 900,
  importProgressPercent: {
    boot: 0,
    resolving: 16,
    fetching: 40,
    checking: 58,
    converting: 72,
    saving: 88,
    idle: 12,
    complete: 100,
  },
};

const POPUP_BOOT = {
  initStepTimeoutMs: 3000,
  fallbackTab: "all",
};

const POPUP_GRID = {
  transientStatusDurationMs: 5000,
  armedDeleteDurationMs: 5000,
  copyHintDurationMs: 5000,
};

const OPTIONS_FEEDBACK = {
  maxChars: 500,
};

export {
  STORAGE_KEYS,
  CONTEXT_MENU,
  OFFSCREEN,
  IMPORT_PIPELINE,
  DB,
  GIF_CONVERSION,
  BADGE,
  BRAND_LOGOS,
  POPUP_MENU,
  POPUP_BOOT,
  POPUP_GRID,
  OPTIONS_FEEDBACK,
};
