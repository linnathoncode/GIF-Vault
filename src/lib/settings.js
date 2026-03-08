const STORAGE_KEYS = {
  themeMode: "themeMode",
  importState: "importState"
};

const CONTEXT_MENU = {
  addToVaultId: "addToGifVault"
};

const OFFSCREEN = {
  url: "offscreen/offscreen.html"
};

const DB = {
  name: "gifVaultDB",
  version: 2,
  mediaStore: "media",
  logStore: "logs",
  logMaxItems: 250
};

const GIF_CONVERSION = {
  fps: 10,
  width: 360,
  maxColors: 96,
  maxDurationSeconds: 15
};

const BADGE = {
  okColor: "#0f766e",
  errorColor: "#8b2635",
  okText: "+",
  errorText: "!",
  clearDelayMs: 3000
};

export { STORAGE_KEYS, CONTEXT_MENU, OFFSCREEN, DB, GIF_CONVERSION, BADGE };
