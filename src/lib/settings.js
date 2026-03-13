const STORAGE_KEYS = {
  themeMode: "themeMode",
  importState: "importState",
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
  logMaxItems: 250,
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
  copyFeedbackResetDelayMs: 900,
  importProgressPercent: {
    resolving: 16,
    fetching: 40,
    converting: 66,
    saving: 88,
    idle: 12,
    complete: 100,
  },
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
};
