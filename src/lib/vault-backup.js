// Portable vault backup format. This module serializes media bytes with their
// metadata and validates a whole restore before callers write anything to IDB.

const BACKUP_FORMAT = "gif-vault-backup";
const BACKUP_VERSION = 1;
const BACKUP_MIME_TYPE = "application/json";

async function createVaultBackup(mediaItems, blobsById) {
  const backupItems = [];
  for (const item of mediaItems || []) {
    const blob = blobsById?.get(item?.id);
    if (!(blob instanceof Blob) || !String(item?.id || "").trim()) {
      throw new Error("Couldn't read every item in the vault.");
    }

    backupItems.push({
      metadata: toBackupMetadata(item, blob),
      data: toBase64(new Uint8Array(await blob.arrayBuffer())),
    });
  }

  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    items: backupItems,
  });
}

function parseVaultBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    throw new Error("That file is not a valid GIF Vault backup.");
  }

  if (
    !parsed ||
    parsed.format !== BACKUP_FORMAT ||
    parsed.version !== BACKUP_VERSION ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("That file is not a supported GIF Vault backup.");
  }

  const seenIds = new Set();
  return parsed.items.map((entry) => parseBackupItem(entry, seenIds));
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const base64 = String(value || "");
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Backup contains invalid media data.");
  }

  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function toBackupMetadata(item, blob) {
  return {
    id: stringValue(item?.id),
    name: stringValue(item?.name),
    localPath: stringValue(item?.localPath),
    sourceUrl: stringValue(item?.sourceUrl),
    mediaUrl: stringValue(item?.mediaUrl),
    pageUrl: stringValue(item?.pageUrl),
    mimeType: stringValue(item?.mimeType) || blob.type,
    kind: stringValue(item?.kind),
    converted: Boolean(item?.converted),
    favorite: Boolean(item?.favorite),
    savedAt: numberValue(item?.savedAt),
    blobSize: blob.size,
  };
}

function parseBackupItem(entry, seenIds) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Backup contains an invalid item.");
  }

  const metadata = entry.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Backup contains invalid item metadata.");
  }

  const id = stringValue(metadata.id).trim();
  const mimeType = stringValue(metadata.mimeType).trim();
  if (!id || seenIds.has(id) || !/^(image|video)\//i.test(mimeType)) {
    throw new Error("Backup contains invalid or duplicate media.");
  }
  seenIds.add(id);

  const bytes = fromBase64(entry.data);
  const blob = new Blob([bytes], { type: mimeType });
  if (blob.size === 0) {
    throw new Error("Backup contains empty media data.");
  }

  return {
    ...toBackupMetadata(metadata, blob),
    id,
    mimeType,
    blob,
  };
}

export {
  BACKUP_MIME_TYPE,
  createVaultBackup,
  parseVaultBackup,
};
