import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map(),
  importFiles: vi.fn(),
  applyStaticI18n: vi.fn(),
  initializeI18n: vi.fn(async () => ({ locale: "en" })),
  safeLog: vi.fn(async () => {}),
  getThemeMode: vi.fn(async () => "light"),
  setThemeMode: vi.fn(async () => {}),
  setToolbarIcon: vi.fn(async () => {}),
  applyDocumentTheme: vi.fn(() => "light"),
}));

vi.mock("../../src/lib/i18n.js", () => ({
  applyStaticI18n: mocks.applyStaticI18n,
  initializeI18n: mocks.initializeI18n,
}));

vi.mock("../../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../../src/lib/theme.js", () => ({
  applyDocumentTheme: mocks.applyDocumentTheme,
  getThemeMode: mocks.getThemeMode,
  setThemeMode: mocks.setThemeMode,
  setToolbarIcon: mocks.setToolbarIcon,
}));

vi.mock("../../src/pages/popup/popup/grid.js", () => ({
  createPopupGridController: () => ({
    clearSelections: vi.fn(),
    cleanupObjectUrls: vi.fn(),
    deleteSelectedItems: vi.fn(async () => false),
    getSelectedCount: vi.fn(() => 0),
    hideHoverPreview: vi.fn(),
    render: vi.fn(async () => {}),
    updateEmptyStateMascotForTheme: vi.fn(),
  }),
}));

vi.mock("../../src/pages/popup/popup/status.js", () => ({
  createPopupStatusController: () => ({
    applyImportState: vi.fn(),
    clearTransientStatus: vi.fn(),
    hasTransientStatus: vi.fn(() => false),
    setImportErrorState: vi.fn(),
    setProgressState: vi.fn(),
    setStatus: vi.fn(),
    showTransientStatus: vi.fn(),
    syncImportActionButton: vi.fn(),
  }),
}));

vi.mock("../../src/pages/popup/popup/import-flow.js", () => ({
  createPopupImportController: () => ({
    importFiles: mocks.importFiles,
    importUrl: vi.fn(async () => {}),
    openLocalFilePicker: vi.fn(),
    terminateImport: vi.fn(async () => {}),
  }),
}));

vi.mock("../../src/pages/popup/popup/tab.js", () => ({
  createPopupTabController: () => ({
    applyCurrentTab: vi.fn(async () => {}),
    resolveInitialTab: vi.fn(async () => "all"),
  }),
}));

function createClassList() {
  const classes = new Set();
  return {
    add(...tokens) {
      for (const token of tokens) {
        classes.add(token);
      }
    },
    remove(...tokens) {
      for (const token of tokens) {
        classes.delete(token);
      }
    },
    toggle(token, force) {
      if (typeof force === "boolean") {
        if (force) {
          classes.add(token);
          return true;
        }
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    },
    contains(token) {
      return classes.has(token);
    },
  };
}

function createElement() {
  const listeners = new Map();
  return {
    value: "",
    textContent: "",
    className: "",
    classList: createClassList(),
    style: {},
    hidden: false,
    disabled: false,
    src: "",
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    setAttribute: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    blur: vi.fn(),
    focus: vi.fn(),
  };
}

function createMockDocument(containedNode) {
  const elements = {
    brandLogo: createElement(),
    clearAllBtn: createElement(),
    count: createElement(),
    grid: createElement(),
    hoverPreview: createElement(),
    hoverPreviewImg: createElement(),
    importBtn: createElement(),
    importBtnIcon: createElement(),
    importBtnLabel: createElement(),
    importInput: createElement(),
    localFileInput: createElement(),
    localImportBtn: createElement(),
    nextPageBtn: createElement(),
    openLogsBtn: createElement(),
    openOptionsBtn: createElement(),
    pageIndicator: createElement(),
    prevPageBtn: createElement(),
    progressBar: createElement(),
    progressLabel: createElement(),
    progressTrack: createElement(),
    selectionCancelBtn: createElement(),
    statusText: createElement(),
    searchInput: createElement(),
    status: createElement(),
    tabAllBtn: createElement(),
    tabFavoritesBtn: createElement(),
    themeToggleIcon: createElement(),
    themeToggleBtn: createElement(),
  };

  return {
    getElementById(id) {
      return elements[id] || null;
    },
    body: {
      classList: createClassList(),
      contains(node) {
        return node === containedNode;
      },
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("popup file-drop guard", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const originalNode = globalThis.Node;
  const originalHtmlInputElement = globalThis.HTMLInputElement;
  const originalHtmlButtonElement = globalThis.HTMLButtonElement;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.listeners = new Map();
    mocks.importFiles = vi.fn();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
    globalThis.Node = originalNode;
    globalThis.HTMLInputElement = originalHtmlInputElement;
    globalThis.HTMLButtonElement = originalHtmlButtonElement;
    vi.restoreAllMocks();
  });

  async function bootPopup() {
    class MockNode {}
    const dragSourceNode = new MockNode();

    globalThis.Node = MockNode;
    globalThis.document = createMockDocument(dragSourceNode);
    globalThis.HTMLInputElement = class HTMLInputElement {};
    globalThis.HTMLButtonElement = class HTMLButtonElement {};
    globalThis.window = {
      addEventListener(type, handler) {
        const handlers = mocks.listeners.get(type) || [];
        handlers.push(handler);
        mocks.listeners.set(type, handlers);
      },
      confirm: vi.fn(() => true),
      prompt: vi.fn(() => ""),
    };
    globalThis.chrome = {
      runtime: {
        id: "ext-id",
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async () => ({ ok: true })),
        getURL: vi.fn((path) => `chrome-extension://ext-id/${path}`),
        openOptionsPage: vi.fn(async () => {}),
      },
      storage: {
        local: {
          get: vi.fn((keys, cb) => {
            const firstKey = Array.isArray(keys) ? keys[0] : keys;
            if (firstKey === "runtimeConfig") {
              cb({});
              return;
            }
            if (firstKey === "importState") {
              cb({ importState: null });
              return;
            }
            cb({});
          }),
          set: vi.fn((_, cb) => cb?.()),
          remove: vi.fn((_, cb) => cb?.()),
        },
        onChanged: { addListener: vi.fn() },
      },
      tabs: {
        create: vi.fn(async () => ({})),
      },
    };

    await import("../../src/pages/popup/popup.js");
    await flush();
    return { dragSourceNode };
  }

  it("ignores file drop when drag started inside popup", async () => {
    const { dragSourceNode } = await bootPopup();
    const [dragStartHandler] = mocks.listeners.get("dragstart");
    const [dropHandler] = mocks.listeners.get("drop");
    const preventDefault = vi.fn();

    dragStartHandler({ target: dragSourceNode });
    dropHandler({
      dataTransfer: {
        types: ["Files"],
        files: [new Blob([new Uint8Array([1, 2, 3])], { type: "image/gif" })],
        getData: vi.fn(() => ""),
      },
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.importFiles).not.toHaveBeenCalled();
  });

  it("imports file drop when drag started outside popup", async () => {
    await bootPopup();
    const [dropHandler] = mocks.listeners.get("drop");
    const preventDefault = vi.fn();

    dropHandler({
      dataTransfer: {
        types: ["Files"],
        files: [new Blob([new Uint8Array([1, 2, 3])], { type: "image/gif" })],
        getData: vi.fn(() => ""),
      },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.importFiles).toHaveBeenCalledTimes(1);
  });
});
