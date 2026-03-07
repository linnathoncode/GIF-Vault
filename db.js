const DB_NAME = "gifVaultDB";
const DB_VERSION = 2;
const STORE_NAME = "media";
const LOG_STORE_NAME = "logs";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        const logs = db.createObjectStore(LOG_STORE_NAME, { keyPath: "id" });
        logs.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function runTx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);

    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  }));
}

function runLogTx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(LOG_STORE_NAME, mode);
    const store = tx.objectStore(LOG_STORE_NAME);

    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB log transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB log transaction aborted"));
  }));
}

function idbSave(item) {
  return runTx("readwrite", (store) => {
    store.put(item);
    return item;
  });
}

function idbGetAll() {
  return runTx("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const items = Array.isArray(request.result) ? request.result : [];
      items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      resolve(items);
    };
    request.onerror = () => reject(request.error || new Error("Failed to read IndexedDB items"));
  }));
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
      createdAt: Date.now()
    };
    store.put(item);
    return item;
  });
}

function idbGetLogs(limit = 100) {
  return runLogTx("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const items = Array.isArray(request.result) ? request.result : [];
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(items.slice(0, Math.max(1, limit)));
    };
    request.onerror = () => reject(request.error || new Error("Failed to read logs"));
  }));
}

function idbClearLogs() {
  return runLogTx("readwrite", (store) => {
    store.clear();
    return true;
  });
}

export { idbSave, idbGetAll, idbDelete, idbClear, idbLog, idbGetLogs, idbClearLogs };
