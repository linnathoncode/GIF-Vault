/**
 * Import service composition root.
 * Wires broad import modules (control, pipeline, runtime, media, offscreen)
 * and exports the public import API used by the background service worker.
 */
import { idbDelete, idbSave } from "../../lib/db.js";
import { extensionFromUrl } from "../../lib/media.js";
import { getRuntimeConfig } from "../../lib/runtime-config.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import {
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
} from "../../lib/protocol.js";
import {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrls,
} from "../media-resolver.js";
import { createImportControl } from "./control.js";
import { convertInOffscreen } from "./offscreen.js";
import {
  blobFromConvertedPayload,
  buildLocalPseudoUrl,
  inferName,
  inferNameFromLocalFile,
  getLocalFileByteLength,
  materializeLocalFileBlob,
  mediaTooLargeMessage,
  normalizeHttpUrl,
  normalizeLocalFiles,
  normalizeOptionalHttpUrl,
  normalizeResolvedHints,
  readBlobSniffBytes,
  readBlobWithMaxSize,
  resolveMaxDownloadBytes,
} from "./media-utils.js";
import { createImportPipeline } from "./pipeline.js";
import {
  ensureOriginAccess,
  notifyVaultUpdated,
  reportProgress,
} from "./runtime.js";
import { createImportRunner } from "./runner.js";

const control = createImportControl({
  UI_MESSAGES,
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
  safeLog,
  reportProgress,
});

const pipeline = createImportPipeline({
  idbDelete,
  idbSave,
  extensionFromUrl,
  safeLog,
  UI_MESSAGES,
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  convertInOffscreen,
  blobFromConvertedPayload,
  buildLocalPseudoUrl,
  inferName,
  inferNameFromLocalFile,
  getLocalFileByteLength,
  materializeLocalFileBlob,
  mediaTooLargeMessage,
  normalizeHttpUrl,
  readBlobSniffBytes,
  readBlobWithMaxSize,
  resolveMaxDownloadBytes,
  ensureOriginAccess,
  reportProgress,
  notifyVaultUpdated,
  raceWithImportAbort: control.raceWithImportAbort,
});

const runner = createImportRunner({
  getRuntimeConfig,
  safeLog,
  UI_MESSAGES,
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
  resolveMediaUrls,
  normalizeHttpUrl,
  normalizeLocalFiles,
  normalizeOptionalHttpUrl,
  normalizeResolvedHints,
  ensureOriginAccess,
  reportProgress,
  notifyVaultUpdated,
  control,
  pipeline,
});

const importFromUrl = runner.importFromUrl;
const importFromFiles = runner.importFromFiles;
const terminateImport = control.terminateImport;

export { importFromFiles, importFromUrl, terminateImport };
