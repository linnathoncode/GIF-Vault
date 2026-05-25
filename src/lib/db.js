import { DB } from "./settings.js";

const MEDIA_INDEX = {
  savedAt: "savedAt",
};

// Database open and schema migration.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, DB.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      let mediaStore;
      if (!db.objectStoreNames.contains(DB.mediaStore)) {
        mediaStore = db.createObjectStore(DB.mediaStore, { keyPath: "id" });
      } else {
        mediaStore = request.transaction.objectStore(DB.mediaStore);
      }
      ensureMediaIndexes(mediaStore);
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

function ensureMediaIndexes(mediaStore) {
  if (!mediaStore) {
    return;
  }
  if (!mediaStore.indexNames.contains(MEDIA_INDEX.savedAt)) {
    mediaStore.createIndex(MEDIA_INDEX.savedAt, "savedAt", { unique: false });
  }
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
    localPath: item.localPath || item.sourcePath || item.filePath || "",
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

function normalizeMediaMetadata(item) {
  return {
    ...item,
    favorite: Boolean(item?.favorite),
    name: item?.name || "",
  };
}

function matchesMediaQuery(item, query) {
  if (!query) {
    return true;
  }

  const haystack =
    `${item.name || ""} ${item.sourceUrl || ""} ${item.mediaUrl || ""} ${item.localPath || ""} local`.toLowerCase();
  return haystack.includes(query);
}

function readRequest(request, errorMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(errorMessage));
  });
}

function readCursorPage(cursorRequest, startIndex, pageSize, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const items = [];
    let visibleIndex = 0;

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || items.length >= pageSize) {
        resolve(items);
        return;
      }

      const item = normalizeMediaMetadata(cursor.value || {});
      if (!predicate(item)) {
        cursor.continue();
        return;
      }

      if (visibleIndex < startIndex) {
        const remainingSkip = startIndex - visibleIndex;
        visibleIndex = startIndex;
        if (typeof cursor.advance === "function") {
          cursor.advance(remainingSkip);
        } else {
          cursor.continue();
        }
        return;
      }

      visibleIndex += 1;
      items.push(item);
      cursor.continue();
    };
    cursorRequest.onerror = () =>
      reject(
        cursorRequest.error || new Error("Failed to read IndexedDB page"),
      );
  });
}

function readFilteredMediaPage(index, { currentTab, pageSize, query, requestedPage, startIndex }) {
  return new Promise((resolve, reject) => {
    let savedCount = 0;
    let favoritesCount = 0;
    let visibleCount = 0;
    const pageItems = [];
    const cursorRequest = index.openCursor(null, "prev");

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        const totalPages = Math.max(1, Math.ceil(visibleCount / pageSize));
        const currentPage = Math.min(requestedPage, totalPages);
        resolve({
          currentPage,
          favoritesCount,
          items: pageItems,
          query,
          savedCount,
          totalPages,
          visibleCount,
        });
        return;
      }

      const item = normalizeMediaMetadata(cursor.value || {});
      savedCount += 1;
      if (item.favorite) {
        favoritesCount += 1;
      }

      const isVisibleByTab = currentTab !== "favorites" || item.favorite;
      const isVisible = isVisibleByTab && matchesMediaQuery(item, query);
      if (isVisible) {
        if (
          visibleCount >= startIndex &&
          pageItems.length < pageSize
        ) {
          pageItems.push(item);
        }
        visibleCount += 1;
      }

      cursor.continue();
    };
    cursorRequest.onerror = () =>
      reject(
        cursorRequest.error || new Error("Failed to read IndexedDB page"),
      );
  });
}

function readFavoriteCount(index) {
  return new Promise((resolve, reject) => {
    let favoritesCount = 0;
    const cursorRequest = index.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(favoritesCount);
        return;
      }

      if (cursor.value?.favorite) {
        favoritesCount += 1;
      }
      cursor.continue();
    };
    cursorRequest.onerror = () =>
      reject(
        cursorRequest.error || new Error("Failed to count favorite media records"),
      );
  });
}

function idbGetMediaPage({
  currentTab = "all",
  page = 1,
  pageSize = 12,
  query = "",
} = {}) {
  const requestedPage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const tab = currentTab === "favorites" ? "favorites" : "all";
  const startIndex = (requestedPage - 1) * safePageSize;

  return runMediaTx("readonly", [DB.mediaStore], (tx) => {
    const store = tx.objectStore(DB.mediaStore);
    const savedAtIndex = store.index(MEDIA_INDEX.savedAt);

    if (normalizedQuery || tab === "favorites") {
      return readFilteredMediaPage(savedAtIndex, {
        currentTab: tab,
        pageSize: safePageSize,
        query: normalizedQuery,
        requestedPage,
        startIndex,
      });
    }

    const savedCountPromise = readRequest(
      store.count(),
      "Failed to count media records",
    );
    const pageItemsPromise = readCursorPage(
      savedAtIndex.openCursor(null, "prev"),
      startIndex,
      safePageSize,
    );
    const favoritesCountPromise = readFavoriteCount(savedAtIndex);

    return Promise.all([
      savedCountPromise,
      favoritesCountPromise,
      pageItemsPromise,
    ]).then(([savedCount, favoritesCount, items]) => {
      const totalPages = Math.max(1, Math.ceil(savedCount / safePageSize));
      return {
        currentPage: Math.min(requestedPage, totalPages),
        favoritesCount,
        items,
        query: normalizedQuery,
        savedCount,
        totalPages,
        visibleCount: savedCount,
      };
    });
  }).then((result) => {
    if (result.currentPage === requestedPage) {
      return result;
    }

    return idbGetMediaPage({
      currentTab: tab,
      page: result.currentPage,
      pageSize: safePageSize,
      query: normalizedQuery,
    });
  });
}

function idbGetMediaBlobs(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return Promise.resolve(new Map());
  }

  return readMediaBlobs(uniqueIds).then((blobById) => {
    const missingIds = uniqueIds.filter((id) => !blobById.has(id));
    if (missingIds.length === 0) {
      return blobById;
    }

    return migrateLegacyMediaBlobs(missingIds).then((legacyBlobById) => {
      for (const [id, blob] of legacyBlobById) {
        blobById.set(id, blob);
      }
      return blobById;
    });
  });
}

function readMediaBlobs(ids) {
  return runMediaTx("readonly", [DB.mediaBlobStore], (tx) => {
    const blobStore = tx.objectStore(DB.mediaBlobStore);

    return Promise.all(
      ids.map(
        (id) =>
          new Promise((resolve, reject) => {
            const blobRequest = blobStore.get(id);
            blobRequest.onsuccess = () => {
              const blobRecord = blobRequest.result || null;
              if (blobRecord?.blob instanceof Blob) {
                resolve([id, blobRecord.blob]);
                return;
              }

              resolve([id, null]);
            };
            blobRequest.onerror = () =>
              reject(
                blobRequest.error || new Error(`Failed to read blob for ${id}`),
              );
          }),
      ),
    ).then((entries) => new Map(entries.filter(([, blob]) => blob)));
  });
}

function migrateLegacyMediaBlobs(ids) {
  return runMediaTx(
    "readwrite",
    [DB.mediaStore, DB.mediaBlobStore],
    (tx) => {
      const mediaStore = tx.objectStore(DB.mediaStore);
      const blobStore = tx.objectStore(DB.mediaBlobStore);

      return Promise.all(
        ids.map(
          (id) =>
            new Promise((resolve, reject) => {
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
            }),
        ),
      ).then((entries) => new Map(entries.filter(([, blob]) => blob)));
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

function idbGetLogs(limit = DB.logMaxItems) {
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
  idbGetMediaPage,
  idbGetMediaBlobs,
  idbDelete,
  idbClear,
  idbLog,
  idbGetLogs,
  idbClearLogs,
};
