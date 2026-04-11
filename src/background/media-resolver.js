/**
 * Backward-compatible media-resolver shim.
 * Re-exports the resolver API from `src/background/import/media-resolver.js`
 * so existing imports and tests remain stable after folder reorganization.
 */
export {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
  resolveMediaUrls,
} from "./import/media-resolver.js";
