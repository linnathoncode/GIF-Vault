import { DB } from "./settings.js";

// Database open and schema migration.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, DB.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      let mediaStore;
      if (!db.objectStoreNames.contains(DB.mediaStore)) {
        mediaStore = db.createObjectStore(DB.mediaStore, { keyPath: "id" });
        mediaStore.createIndex("savedAt", "savedAt", { unique: false });
      } else {
        mediaStore = request.transaction.objectStore(DB.mediaStore);
      }
      if (!db.objectStoreNames.contains(DB.mediaBlobStore)) {
        db.createObjectStore(DB.mediaBlobStore, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DB.logStore)) {
        const logs = db.createObjectStore(DB.logStore, { keyPath: "id" });
        logs.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (request.oldVersion < 3) {
        migrateMediaStore(request.transaction, mediaStore);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function migrateMediaStore(tx, mediaStore) {
  if (!tx || !mediaStore) {
    return;
  }

  const blobStore = tx.objectStore(DB.mediaBlobStore);
  const cursorRequest = mediaStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      return;
    }

    const item = cursor.value || {};
    if (item.blob instanceof Blob) {
      blobStore.put({ id: item.id, blob: item.blob });
      cursor.update(toMediaMetadata(item));
      cursor.continue();
      return;
    }

    if ("blob" in item) {
      cursor.update(toMediaMetadata(item));
    }
    cursor.continue();
  };
}

// Shared transaction wrappers.
function runMediaTx(mode, storeNames, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);

        let result;
        try {
          result = fn(tx);
        } catch (error) {
          reject(error);
          return;
        }

        tx.oncomplete = () => resolve(result);
        tx.onerror = () =>
          reject(tx.error || new Error("IndexedDB transaction failed"));
        tx.onabort = () =>
          reject(tx.error || new Error("IndexedDB transaction aborted"));
      }),
  );
}

function runLogTx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB.logStore, mode);
        const store = tx.objectStore(DB.logStore);

        let result;
        try {
          result = fn(store);
        } catch (error) {
          reject(error);
          return;
        }

        tx.oncomplete = () => resolve(result);
        tx.onerror = () =>
          reject(tx.error || new Error("IndexedDB log transaction failed"));
        tx.onabort = () =>
          reject(tx.error || new Error("IndexedDB log transaction aborted"));
      }),
  );
}

// Media metadata and blob persistence.
function toMediaMetadata(item) {
  return {
    id: item.id,
    name: item.name || "",
    sourceUrl: item.sourceUrl || "",
    mediaUrl: item.mediaUrl || "",
    pageUrl: item.pageUrl || "",
    mimeType: item.mimeType || "",
    kind: item.kind || "",
    converted: Boolean(item.converted),
    favorite: Boolean(item.favorite),
    savedAt: item.savedAt || 0,
    blobSize: item.blob instanceof Blob ? item.blob.size : item.blobSize || 0,
  };
}

function idbSave(item) {
  return runMediaTx(
    "readwrite",
    [DB.mediaStore, DB.mediaBlobStore],
    (tx) => {
      tx.objectStore(DB.mediaStore).put(toMediaMetadata(item));
      if (item.blob instanceof Blob) {
        tx.objectStore(DB.mediaBlobStore).put({ id: item.id, blob: item.blob });
      }
      return item;
    },
  );
}

function idbGetAllMedia() {
  return runMediaTx("readonly", [DB.mediaStore], (tx) => {
    const store = tx.objectStore(DB.mediaStore);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = Array.isArray(request.result) ? request.result : [];
        items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        resolve(items);
      };
      request.onerror = () =>
        reject(request.error || new Error("Failed to read IndexedDB items"));
    });
  });
}

function idbGetMediaBlobs(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return Promise.resolve(new Map());
  }

  return runMediaTx(
    "readwrite",
    [DB.mediaStore, DB.mediaBlobStore],
    (tx) => {
      const mediaStore = tx.objectStore(DB.mediaStore);
      const blobStore = tx.objectStore(DB.mediaBlobStore);

      return Promise.all(
        uniqueIds.map(
          (id) =>
            new Promise((resolve, reject) => {
              const blobRequest = blobStore.get(id);
              blobRequest.onsuccess = () => {
                const blobRecord = blobRequest.result || null;
                if (blobRecord?.blob instanceof Blob) {
                  resolve([id, blobRecord.blob]);
                  return;
                }

                const mediaRequest = mediaStore.get(id);
                mediaRequest.onsuccess = () => {
                  const mediaRecord = mediaRequest.result || null;
                  if (mediaRecord?.blob instanceof Blob) {
                    const migratedBlob = mediaRecord.blob;
                    blobStore.put({ id, blob: migratedBlob });
                    mediaStore.put(toMediaMetadata(mediaRecord));
                    resolve([id, migratedBlob]);
                    return;
                  }

                  resolve([id, null]);
                };
                mediaRequest.onerror = () =>
                  reject(
                    mediaRequest.error ||
                      new Error(`Failed to read legacy media for ${id}`),
                  );
              };
              blobRequest.onerror = () =>
                reject(
                  blobRequest.error || new Error(`Failed to read blob for ${id}`),
                );
            }),
        ),
      ).then((entries) => new Map(entries));
    },
  );
}

function idbDelete(id) {
  return runMediaTx(
    "readwrite",
    [DB.mediaStore, DB.mediaBlobStore],
    (tx) => {
      tx.objectStore(DB.mediaStore).delete(id);
      tx.objectStore(DB.mediaBlobStore).delete(id);
      return id;
    },
  );
}

function idbClear() {
  return runMediaTx(
    "readwrite",
    [DB.mediaStore, DB.mediaBlobStore],
    (tx) => {
      tx.objectStore(DB.mediaStore).clear();
      tx.objectStore(DB.mediaBlobStore).clear();
      return true;
    },
  );
}

// Log storage helpers.
function idbLog(stage, message, details = {}) {
  return runLogTx("readwrite", (store) => {
    const item = {
      id: crypto.randomUUID(),
      stage,
      message,
      details,
      createdAt: Date.now(),
    };
    store.put(item);
    pruneOldLogs(store, DB.logMaxItems);
    return item;
  });
}

function idbGetLogs(limit = 250) {
  return runLogTx(
    "readonly",
    (store) =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const items = Array.isArray(request.result) ? request.result : [];
          items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          resolve(items.slice(0, Math.max(1, limit)));
        };
        request.onerror = () =>
          reject(request.error || new Error("Failed to read logs"));
      }),
  );
}

function idbClearLogs() {
  return runLogTx("readwrite", (store) => {
    store.clear();
    return true;
  });
}

function pruneOldLogs(store, maxItems) {
  const request = store.getAll();
  request.onsuccess = () => {
    const items = Array.isArray(request.result) ? request.result : [];
    if (items.length <= maxItems) {
      return;
    }
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const toDelete = items.slice(0, items.length - maxItems);
    for (const log of toDelete) {
      if (log && log.id) {
        store.delete(log.id);
      }
    }
  };
}

export {
  idbSave,
  idbGetAllMedia,
  idbGetMediaBlobs,
  idbDelete,
  idbClear,
  idbLog,
  idbGetLogs,
  idbClearLogs,
};
