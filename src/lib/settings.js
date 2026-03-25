const STORAGE_KEYS = {
  themeMode: "themeMode",
  locale: "locale",
  importState: "importState",
  runtimeConfig: "runtimeConfig",
  popupLastTab: "popupLastTab",
};

const CONTEXT_MENU = {
  addToVaultId: "addToGifVault",
};

const OFFSCREEN = {
  url: "offscreen/offscreen.html",
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
  maxDurationSeconds: 15,
};

const BADGE = {
  okColor: "#0f766e",
  errorColor: "#8b2635",
  okText: "+",
  errorText: "!",
  clearDelayMs: 3000,
};

const ICONS = {
  light: {
    16: "assets/icons/icon-light-16.png",
    32: "assets/icons/icon-light-32.png",
    48: "assets/icons/icon-light-48.png",
    128: "assets/icons/icon-light-128.png",
  },
  dark: {
    16: "assets/icons/icon-dark-16.png",
    32: "assets/icons/icon-dark-32.png",
    48: "assets/icons/icon-dark-48.png",
    128: "assets/icons/icon-dark-128.png",
  },
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
  statusQueryMaxLength: 120,
  fallbackTab: "all",
};

export {
  STORAGE_KEYS,
  CONTEXT_MENU,
  OFFSCREEN,
  DB,
  GIF_CONVERSION,
  BADGE,
  ICONS,
  POPUP_MENU,
  POPUP_BOOT,
};
