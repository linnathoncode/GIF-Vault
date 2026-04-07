/**
 * Backward-compatible import-service shim.
 * Keeps existing imports/tests stable while the implementation lives under
 * `src/background/import/service.js`.
 */
export { importFromFiles, importFromUrl, terminateImport } from "./import/service.js";
