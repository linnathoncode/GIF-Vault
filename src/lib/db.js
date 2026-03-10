import { DB } from "./settings.js";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, DB.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB.mediaStore)) {
        const store = db.createObjectStore(DB.mediaStore, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(DB.logStore)) {
        const logs = db.createObjectStore(DB.logStore, { keyPath: "id" });
        logs.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function runTx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB.mediaStore, mode);
        const store = tx.objectStore(DB.mediaStore);

        let result;
        try {
          result = fn(store);
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

function idbSave(item) {
  return runTx("readwrite", (store) => {
    store.put(item);
    return item;
  });
}

function idbGetAll() {
  return runTx(
    "readonly",
    (store) =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const items = Array.isArray(request.result) ? request.result : [];
          items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
          resolve(items);
        };
        request.onerror = () =>
          reject(request.error || new Error("Failed to read IndexedDB items"));
      }),
  );
}

function idbDelete(id) {
  return runTx("readwrite", (store) => {
    store.delete(id);
    return id;
  });
}

function idbClear() {
  return runTx("readwrite", (store) => {
    store.clear();
    return true;
  });
}

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
  idbGetAll,
  idbDelete,
  idbClear,
  idbLog,
  idbGetLogs,
  idbClearLogs,
};
