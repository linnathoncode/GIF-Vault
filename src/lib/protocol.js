const MESSAGE_TYPES = {
  importFiles: "IMPORT_FILES",
  importUrl: "IMPORT_URL",
  importProgress: "IMPORT_PROGRESS",
  offscreenCancelConversion: "OFFSCREEN_CANCEL_CONVERSION",
  resolveMediaUrl: "RESOLVE_MEDIA_URL",
  terminateImport: "TERMINATE_IMPORT",
  vaultUpdated: "VAULT_UPDATED",
};

const IMPORT_ERROR_CODES = {
  concurrentImportInProgress: "IMPORT_ALREADY_RUNNING",
  hostAccessRequired: "HOST_ACCESS_REQUIRED",
  importTerminated: "IMPORT_TERMINATED",
  invalidUrl: "INVALID_URL",
};

function isRuntimeMessage(message) {
  return Boolean(message) && typeof message === "object" && !Array.isArray(message);
}

function createImportError(code, message) {
  const error = new Error(String(message || ""));
  error.code = String(code || "");
  return error;
}

function getImportErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" ? code : "";
}

export {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
  isRuntimeMessage,
  createImportError,
  getImportErrorCode,
};
