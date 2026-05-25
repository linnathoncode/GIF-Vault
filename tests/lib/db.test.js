import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DB } from "../../src/lib/settings.js";

function createStore(initial = []) {
  return new Map(initial.map((item) => [item.id, item]));
}

function createIndexedDbFake(stores) {
  const transactions = [];

  class FakeTransaction {
    constructor(storeNames, mode) {
      this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
      this.mode = mode;
      this.error = null;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.pending = 0;
      this.completed = false;
    }

    objectStore(name) {
      const store = stores.get(name);
      if (!store) {
        throw new Error(`Unknown object store: ${name}`);
      }

      return {
        get: (id) =>
          this.request(() => {
            return store.get(id);
          }),
        put: (record) =>
          this.request(() => {
            store.set(record.id, record);
            return record.id;
          }),
      };
    }

    request(fn) {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
      };

      this.pending += 1;
      queueMicrotask(() => {
        try {
          request.result = fn();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          this.error = error;
          request.onerror?.();
          this.onerror?.();
        } finally {
          this.pending -= 1;
          this.completeWhenIdle();
        }
      });

      return request;
    }

    completeWhenIdle() {
      if (this.pending > 0 || this.completed) {
        return;
      }

      this.completed = true;
      queueMicrotask(() => this.oncomplete?.());
    }
  }

  const fakeDb = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    transaction: (storeNames, mode) => {
      const tx = new FakeTransaction(storeNames, mode);
      transactions.push(tx);
      return tx;
    },
  };

  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }),
  };

  return { indexedDB, transactions };
}

describe("db media blob reads", () => {
  let originalIndexedDb;

  beforeEach(() => {
    vi.resetModules();
    originalIndexedDb = globalThis.indexedDB;
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDb;
    vi.restoreAllMocks();
  });

  it("hydrates existing split blobs through a readonly blob-store transaction", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/gif" });
    const stores = new Map([
      [DB.mediaStore, createStore()],
      [DB.mediaBlobStore, createStore([{ id: "item-1", blob }])],
      [DB.logStore, createStore()],
    ]);
    const fake = createIndexedDbFake(stores);
    globalThis.indexedDB = fake.indexedDB;

    const { idbGetMediaBlobs } = await import("../../src/lib/db.js");
    const blobById = await idbGetMediaBlobs(["item-1"]);

    expect(blobById.get("item-1")).toBe(blob);
    expect(fake.transactions).toHaveLength(1);
    expect(fake.transactions[0].mode).toBe("readonly");
    expect(fake.transactions[0].storeNames).toEqual([DB.mediaBlobStore]);
  });

  it("uses an isolated readwrite transaction only when legacy media blobs need migration", async () => {
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/gif" });
    const legacyRecord = {
      id: "legacy-1",
      name: "legacy.gif",
      blob,
      savedAt: 1,
    };
    const stores = new Map([
      [DB.mediaStore, createStore([legacyRecord])],
      [DB.mediaBlobStore, createStore()],
      [DB.logStore, createStore()],
    ]);
    const fake = createIndexedDbFake(stores);
    globalThis.indexedDB = fake.indexedDB;

    const { idbGetMediaBlobs } = await import("../../src/lib/db.js");
    const blobById = await idbGetMediaBlobs(["legacy-1"]);

    expect(blobById.get("legacy-1")).toBe(blob);
    expect(fake.transactions.map((tx) => tx.mode)).toEqual([
      "readonly",
      "readwrite",
    ]);
    expect(fake.transactions[0].storeNames).toEqual([DB.mediaBlobStore]);
    expect(fake.transactions[1].storeNames).toEqual([
      DB.mediaStore,
      DB.mediaBlobStore,
    ]);
    expect(stores.get(DB.mediaBlobStore).get("legacy-1")).toEqual({
      id: "legacy-1",
      blob,
    });
    expect(stores.get(DB.mediaStore).get("legacy-1")).not.toHaveProperty("blob");
  });
});
