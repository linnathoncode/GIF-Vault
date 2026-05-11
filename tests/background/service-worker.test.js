import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeI18n: vi.fn(async () => {}),
  safeLog: vi.fn(async () => {}),
  importFromFiles: vi.fn(async () => ({})),
  importFromUrl: vi.fn(async () => ({})),
  terminateImport: vi.fn(async () => true),
  resolveMediaUrls: vi.fn(async () => []),
  showBadgeFallback: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/i18n.js", () => ({
  initializeI18n: mocks.initializeI18n,
}));

vi.mock("../../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../../src/background/import-service.js", () => ({
  importFromFiles: mocks.importFromFiles,
  importFromUrl: mocks.importFromUrl,
  terminateImport: mocks.terminateImport,
}));

vi.mock("../../src/background/media-resolver.js", () => ({
  resolveMediaUrls: mocks.resolveMediaUrls,
}));

vi.mock("../../src/background/action-icon.js", () => ({
  showBadgeFallback: mocks.showBadgeFallback,
}));

describe("service worker context menu setup", () => {
  let runtimeOnInstalledListener;
  let originalChrome;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    runtimeOnInstalledListener = null;
    originalChrome = globalThis.chrome;

    globalThis.chrome = {
      contextMenus: {
        create: vi.fn(),
        update: vi.fn(async () => {}),
        onClicked: { addListener: vi.fn() },
      },
      runtime: {
        id: "ext-id",
        lastError: null,
        getURL: vi.fn((path) => `chrome-extension://ext-id/${path}`),
        onInstalled: {
          addListener: vi.fn((listener) => {
            runtimeOnInstalledListener = listener;
          }),
        },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        onChanged: { addListener: vi.fn() },
      },
      tabs: {
        create: vi.fn(async () => {}),
      },
    };

    await import("../../src/background/service-worker.js");
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("handles duplicate-id create attempts without unhandled runtime errors", async () => {
    const duplicateIdError = new Error(
      "Cannot create item with duplicate id addToGifVault",
    );
    let createCount = 0;
    globalThis.chrome.contextMenus.create.mockImplementation((_props, callback) => {
      createCount += 1;
      if (createCount >= 2) {
        globalThis.chrome.runtime.lastError = duplicateIdError;
      } else {
        globalThis.chrome.runtime.lastError = null;
      }
      callback?.();
    });

    const unhandledRejections = [];
    const onUnhandledRejection = (reason) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    runtimeOnInstalledListener();
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtimeOnInstalledListener();
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", onUnhandledRejection);

    expect(globalThis.chrome.contextMenus.create).toHaveBeenCalledTimes(4);
    expect(unhandledRejections).toHaveLength(0);
  });
});
