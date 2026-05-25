import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DB } from "../../src/lib/settings.js";

function createStore(initial = []) {
  return new Map(initial.map((item) => [item.id, item]));
}

function createIndexedDbFake(stores) {
  const transactions = [];

  function compareKeys(a, b) {
    const left = Array.isArray(a) ? a : [a];
    const right = Array.isArray(b) ? b : [b];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] < right[index]) {
        return -1;
      }
      if (left[index] > right[index]) {
        return 1;
      }
    }
    return 0;
  }

  function isInRange(key, range) {
    if (!range) {
      return true;
    }
    if ("only" in range) {
      return compareKeys(key, range.only) === 0;
    }
    return compareKeys(key, range.lower) >= 0 && compareKeys(key, range.upper) <= 0;
  }

  function indexKey(record, indexName) {
    if (indexName === "savedAt") {
      return record.savedAt || 0;
    }
    throw new Error(`Unknown index: ${indexName}`);
  }

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
        count: () =>
          this.request(() => {
            return store.size;
          }),
        put: (record) =>
          this.request(() => {
            store.set(record.id, record);
            return record.id;
          }),
        index: (indexName) => {
          indexKey({}, indexName);

          return {
            count: (key) =>
              this.request(() => {
                return [...store.values()].filter(
                  (record) => compareKeys(indexKey(record, indexName), key) === 0,
                ).length;
              }),
            openCursor: (range = null, direction = "next") =>
              this.cursorRequest([...store.values()], direction, {
                getKey: (record) => indexKey(record, indexName),
                range,
              }),
          };
        },
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

    cursorRequest(records, direction, { getKey = (record) => record.id, range = null } = {}) {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      const sorted = records
        .filter((record) => isInRange(getKey(record), range))
        .sort((a, b) => compareKeys(getKey(a), getKey(b)));
      if (direction === "prev") {
        sorted.reverse();
      }

      let index = 0;
      this.pending += 1;

      const step = () => {
        try {
          const value = sorted[index] || null;
          if (!value) {
            request.result = null;
            request.onsuccess?.();
            this.pending -= 1;
            this.completeWhenIdle();
            return;
          }

          let continued = false;
          request.result = {
            value,
            advance: (count) => {
              continued = true;
              index += Math.max(1, Number(count) || 1);
              queueMicrotask(step);
            },
            continue: () => {
              continued = true;
              index += 1;
              queueMicrotask(step);
            },
          };
          request.onsuccess?.();
          if (!continued) {
            this.pending -= 1;
            this.completeWhenIdle();
          }
        } catch (error) {
          request.error = error;
          this.error = error;
          request.onerror?.();
          this.onerror?.();
          this.pending -= 1;
          this.completeWhenIdle();
        }
      };

      queueMicrotask(step);
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

  it("reads metadata pages from the savedAt index without materializing all blobs", async () => {
    const stores = new Map([
      [
        DB.mediaStore,
        createStore([
          { id: "old", name: "old.gif", savedAt: 1, favorite: false },
          { id: "new", name: "new.gif", savedAt: 3, favorite: true },
          { id: "mid", name: "mid.gif", savedAt: 2, favorite: true },
        ]),
      ],
      [DB.mediaBlobStore, createStore()],
      [DB.logStore, createStore()],
    ]);
    const fake = createIndexedDbFake(stores);
    globalThis.indexedDB = fake.indexedDB;

    const { idbGetMediaPage } = await import("../../src/lib/db.js");
    const page = await idbGetMediaPage({ page: 1, pageSize: 2 });

    expect(page.items.map((item) => item.id)).toEqual(["new", "mid"]);
    expect(page).toMatchObject({
      currentPage: 1,
      favoritesCount: 2,
      savedCount: 3,
      totalPages: 2,
      visibleCount: 3,
    });
    expect(fake.transactions).toHaveLength(1);
    expect(fake.transactions[0].mode).toBe("readonly");
    expect(fake.transactions[0].storeNames).toEqual([DB.mediaStore]);
  });

  it("applies favorites and search filters while collecting only the requested page", async () => {
    const stores = new Map([
      [
        DB.mediaStore,
        createStore([
          { id: "1", name: "cat", sourceUrl: "", savedAt: 1, favorite: true },
          { id: "2", name: "dog", sourceUrl: "", savedAt: 4, favorite: true },
          { id: "3", name: "cat loop", sourceUrl: "", savedAt: 3, favorite: true },
          { id: "4", name: "cat still", sourceUrl: "", savedAt: 2, favorite: false },
        ]),
      ],
      [DB.mediaBlobStore, createStore()],
      [DB.logStore, createStore()],
    ]);
    const fake = createIndexedDbFake(stores);
    globalThis.indexedDB = fake.indexedDB;

    const { idbGetMediaPage } = await import("../../src/lib/db.js");
    const page = await idbGetMediaPage({
      currentTab: "favorites",
      page: 1,
      pageSize: 1,
      query: "cat",
    });

    expect(page.items.map((item) => item.id)).toEqual(["3"]);
    expect(page).toMatchObject({
      currentPage: 1,
      favoritesCount: 3,
      savedCount: 4,
      totalPages: 2,
      visibleCount: 2,
    });
  });

});
