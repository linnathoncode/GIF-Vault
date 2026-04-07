/**
 * Runtime integration helpers for import flows.
 * Encapsulates permission checks and runtime/storage progress broadcasts so
 * runner/pipeline modules stay focused on import domain logic.
 */
import { STORAGE_KEYS } from "../../lib/settings.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import {
  MESSAGE_TYPES,
  IMPORT_ERROR_CODES,
  createImportError,
} from "../../lib/protocol.js";
import { originPatternFromUrl } from "../../lib/ui.js";

async function ensureOriginAccess(rawUrl) {
  const originPattern = originPatternFromUrl(rawUrl);
  if (!originPattern) {
    return;
  }

  const hasAccess = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (hasAccess) {
    return;
  }

  await safeLog("permissions", "Missing host access for origin", {
    origin: originPattern,
  });
  throw createImportError(
    IMPORT_ERROR_CODES.hostAccessRequired,
    UI_MESSAGES.import.hostAccessRequired,
  );
}

async function reportProgress(
  requestId,
  text,
  active = true,
  kind = "info",
  phase = "",
) {
  try {
    const normalizedPhase = String(phase || "").trim();
    await chrome.storage.local.set({
      [STORAGE_KEYS.importState]: {
        requestId,
        text,
        kind,
        phase: normalizedPhase,
        active: Boolean(active),
        updatedAt: Date.now(),
      },
    });
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.importProgress,
      requestId,
      text,
      kind,
      phase: normalizedPhase,
      active: Boolean(active),
    });
  } catch {
    // Popup may be closed; ignore progress delivery failures.
  }
}

async function notifyVaultUpdated(itemId) {
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.vaultUpdated,
      itemId,
    });
  } catch {
    // Popup may be closed; ignore.
  }
}

export {
  ensureOriginAccess,
  notifyVaultUpdated,
  reportProgress,
};
