import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyStaticI18n: vi.fn(),
  initializeI18n: vi.fn(async () => ({ locale: "en" })),
  safeLog: vi.fn(async () => {}),
  getThemeMode: vi.fn(async () => "light"),
  setThemeMode: vi.fn(async () => {}),
  setThemeToggleGlyph: vi.fn(),
  setToolbarIcon: vi.fn(async () => {}),
  applyDocumentTheme: vi.fn(() => "light"),
  renderTabs: [],
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
  setThemeToggleGlyph: mocks.setThemeToggleGlyph,
  setToolbarIcon: mocks.setToolbarIcon,
}));

vi.mock("../../src/pages/popup/popup/grid.js", () => ({
  createPopupGridController: ({ state }) => ({
    clearSelections: vi.fn(),
    cleanupObjectUrls: vi.fn(),
    hideHoverPreview: vi.fn(),
    render: vi.fn(async () => {
      mocks.renderTabs.push(state.currentTab);
    }),
    updateEmptyStateMascotForTheme: vi.fn(),
  }),
}));

vi.mock("../../src/pages/popup/popup/status.js", () => ({
  createPopupStatusController: () => ({
    applyImportState: vi.fn(),
    clearTransientStatus: vi.fn(),
    hasTransientStatus: vi.fn(() => false),
    setImportErrorState: vi.fn(),
    setImportSuccessState: vi.fn(),
    setProgressState: vi.fn(),
    setStatus: vi.fn(),
    showTransientStatus: vi.fn(),
    syncImportActionButton: vi.fn(),
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
    disabled: false,
    src: "",
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    setAttribute: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
    async trigger(type, event = {}) {
      const handlers = listeners.get(type) || [];
      for (const handler of handlers) {
        await handler({
          type,
          target: this,
          button: 0,
          key: "",
          preventDefault: vi.fn(),
          ...event,
        });
      }
    },
  };
}

function createMockDocument() {
  const elements = {
    brandLogo: createElement(),
    clearAllBtn: createElement(),
    count: createElement(),
    grid: createElement(),
    hoverPreview: createElement(),
    hoverPreviewImg: createElement(),
    importBtn: createElement(),
    importInput: createElement(),
    nextPageBtn: createElement(),
    openOptionsBtn: createElement(),
    openTransferBtn: createElement(),
    pageIndicator: createElement(),
    prevPageBtn: createElement(),
    progressBar: createElement(),
    progressLabel: createElement(),
    progressTrack: createElement(),
    statusText: createElement(),
    searchInput: createElement(),
    status: createElement(),
    tabAllBtn: createElement(),
    tabFavoritesBtn: createElement(),
    themeToggleBtn: createElement(),
  };

  return {
    getElementById(id) {
      return elements[id] || null;
    },
    elements,
    body: {
      classList: createClassList(),
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForRender() {
  for (let i = 0; i < 30; i += 1) {
    await flush();
    if (mocks.renderTabs.length > 0) {
      return;
    }
  }
  throw new Error("Popup did not render in time");
}

describe("popup latest-tab persistence", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const originalHtmlInputElement = globalThis.HTMLInputElement;
  const originalHtmlButtonElement = globalThis.HTMLButtonElement;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.renderTabs.length = 0;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
    globalThis.HTMLInputElement = originalHtmlInputElement;
    globalThis.HTMLButtonElement = originalHtmlButtonElement;
    vi.restoreAllMocks();
  });

  it("resolves Latest default tab from stored popupLastTab", async () => {
    const mockDocument = createMockDocument();
    const storageSet = vi.fn((_, cb) => cb?.());

    globalThis.document = mockDocument;
    globalThis.HTMLInputElement = class HTMLInputElement {};
    globalThis.HTMLButtonElement = class HTMLButtonElement {};
    globalThis.window = {
      location: { search: "" },
      addEventListener: vi.fn(),
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
              cb({
                runtimeConfig: {
                  popupMenu: { defaultTab: "latest" },
                },
              });
              return;
            }
            if (firstKey === "popupLastTab") {
              cb({ popupLastTab: "favorites" });
              return;
            }
            if (firstKey === "importState") {
              cb({ importState: null });
              return;
            }
            cb({});
          }),
          set: storageSet,
          remove: vi.fn((_, cb) => cb?.()),
        },
        onChanged: { addListener: vi.fn() },
      },
      tabs: {
        create: vi.fn(async () => ({})),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
    };

    await import("../../src/pages/popup/popup.js");
    await waitForRender();

    expect(mocks.renderTabs.length).toBeGreaterThan(0);
    expect(mocks.renderTabs.at(-1)).toBe("favorites");
    expect(storageSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ popupLastTab: "all" }),
      expect.anything(),
    );
  });

  it("falls back to all for missing stored tab and persists tab clicks", async () => {
    const mockDocument = createMockDocument();
    const storageSet = vi.fn((_, cb) => cb?.());

    globalThis.document = mockDocument;
    globalThis.HTMLInputElement = class HTMLInputElement {};
    globalThis.HTMLButtonElement = class HTMLButtonElement {};
    globalThis.window = {
      location: { search: "" },
      addEventListener: vi.fn(),
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
              cb({
                runtimeConfig: {
                  popupMenu: { defaultTab: "latest" },
                },
              });
              return;
            }
            if (firstKey === "popupLastTab") {
              cb({});
              return;
            }
            if (firstKey === "importState") {
              cb({ importState: null });
              return;
            }
            cb({});
          }),
          set: storageSet,
          remove: vi.fn((_, cb) => cb?.()),
        },
        onChanged: { addListener: vi.fn() },
      },
      tabs: {
        create: vi.fn(async () => ({})),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
    };

    await import("../../src/pages/popup/popup.js");
    await waitForRender();

    expect(mocks.renderTabs.length).toBeGreaterThan(0);
    expect(mocks.renderTabs.at(-1)).toBe("all");

    await mockDocument.elements.tabFavoritesBtn.trigger("click");
    expect(storageSet).toHaveBeenCalledWith(
      { popupLastTab: "favorites" },
      expect.any(Function),
    );

    await mockDocument.elements.tabAllBtn.trigger("click");
    expect(storageSet).toHaveBeenCalledWith(
      { popupLastTab: "all" },
      expect.any(Function),
    );
  });
});
