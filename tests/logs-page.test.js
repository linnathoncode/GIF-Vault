import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_MESSAGES } from "../src/lib/messages.js";

const mocks = vi.hoisted(() => ({
  idbGetLogs: vi.fn(),
  idbClearLogs: vi.fn(),
  initializeI18n: vi.fn(async () => ({ locale: "en" })),
  applyStaticI18n: vi.fn(),
  applyDocumentTheme: vi.fn(() => "light"),
  getThemeMode: vi.fn(async () => "light"),
  setThemeMode: vi.fn(async () => {}),
  setThemeToggleGlyph: vi.fn(),
  setToolbarIcon: vi.fn(async () => {}),
  formatBytes: vi.fn(() => "0 B"),
}));

vi.mock("../src/lib/db.js", () => ({
  idbGetLogs: mocks.idbGetLogs,
  idbClearLogs: mocks.idbClearLogs,
}));

vi.mock("../src/lib/i18n.js", () => ({
  initializeI18n: mocks.initializeI18n,
  applyStaticI18n: mocks.applyStaticI18n,
}));

vi.mock("../src/lib/theme.js", () => ({
  applyDocumentTheme: mocks.applyDocumentTheme,
  getThemeMode: mocks.getThemeMode,
  setThemeMode: mocks.setThemeMode,
  setThemeToggleGlyph: mocks.setThemeToggleGlyph,
  setToolbarIcon: mocks.setToolbarIcon,
}));

vi.mock("../src/lib/ui.js", () => ({
  formatBytes: mocks.formatBytes,
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
    contains(token) {
      return classes.has(token);
    },
  };
}

function createElement() {
  const element = {
    className: "",
    classList: createClassList(),
    src: "",
    alt: "",
    style: {},
    children: [],
    parentElement: null,
    append(...nodes) {
      for (const node of nodes) {
        if (node && typeof node === "object") {
          node.parentElement = this;
        }
      }
      this.children.push(...nodes);
    },
    addEventListener() {},
  };

  let textValue = "";
  let htmlValue = "";
  function clearChildren() {
    for (const child of element.children) {
      if (child && typeof child === "object") {
        child.parentElement = null;
      }
    }
    element.children.length = 0;
  }

  Object.defineProperty(element, "textContent", {
    get() {
      return textValue;
    },
    set(value) {
      textValue = String(value ?? "");
      clearChildren();
    },
  });

  Object.defineProperty(element, "innerHTML", {
    get() {
      return htmlValue;
    },
    set(value) {
      htmlValue = String(value ?? "");
      textValue = "";
      clearChildren();
    },
  });

  return element;
}

function createMockDocument() {
  const elements = {
    logs: createElement(),
    status: createElement(),
    storageUsage: createElement(),
    refreshBtn: createElement(),
    clearBtn: createElement(),
    themeToggleBtn: createElement(),
  };
  elements.status.textContent = UI_MESSAGES.logs.loadingLogs;
  elements.logs.textContent = UI_MESSAGES.logs.loading;

  return {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement() {
      return createElement();
    },
    elements,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("logs page bootstrap", () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalDocument = globalThis.document;
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();

    mocks.idbGetLogs.mockRejectedValue(new Error("IndexedDB unavailable"));
    mocks.idbClearLogs.mockResolvedValue(undefined);

    globalThis.document = createMockDocument();
    globalThis.chrome = {
      storage: {
        onChanged: {
          addListener: vi.fn(),
        },
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          estimate: vi.fn(async () => ({ usage: 1024, quota: 2048 })),
        },
      },
    });
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    }
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not remain in loading state when idbGetLogs throws", async () => {
    vi.useFakeTimers();
    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.failedToLoad);
    expect(statusEl.className).toBe("status");
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("does not remain in loading state when idbGetLogs hangs", async () => {
    vi.useFakeTimers();
    mocks.idbGetLogs.mockImplementation(() => new Promise(() => {}));

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(4500);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.failedToLoad);
    expect(statusEl.className).toBe("status");
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("does not remain in loading state when storage estimate hangs", async () => {
    vi.useFakeTimers();
    mocks.idbGetLogs.mockResolvedValue([]);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          estimate: vi.fn(() => new Promise(() => {})),
        },
      },
    });

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(3000);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const storageUsageEl = globalThis.document.getElementById("storageUsage");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(storageUsageEl.textContent).toBe(UI_MESSAGES.logs.storageEstimateFailed);
    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(statusEl.className).toBe("status ok");
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("does not remain in loading state when i18n initialization hangs", async () => {
    vi.useFakeTimers();
    mocks.initializeI18n.mockImplementationOnce(() => new Promise(() => {}));
    mocks.idbGetLogs.mockResolvedValue([]);

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(3500);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(statusEl.className).toBe("status ok");
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("ignores late i18n completion after timeout and keeps logs structure", async () => {
    vi.useFakeTimers();
    let resolveInitialize = () => {};
    mocks.initializeI18n.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialize = resolve;
        }),
    );
    mocks.idbGetLogs.mockResolvedValue([]);
    mocks.applyStaticI18n.mockImplementation(() => {
      const logsEl = globalThis.document.getElementById("logs");
      logsEl.textContent = UI_MESSAGES.logs.loading;
    });

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(3500);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(logsEl.children.length).toBe(2);
    expect(logsEl.classList.contains("empty-state")).toBe(true);

    resolveInitialize({ locale: "en" });
    await flushMicrotasks();

    const logsContentEl = logsEl.children[1];
    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(logsEl.children.length).toBe(2);
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("does not get stuck when chrome storage API is unavailable", async () => {
    vi.useFakeTimers();
    globalThis.chrome = undefined;
    mocks.idbGetLogs.mockResolvedValue([]);

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(7000);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(statusEl.className).toBe("status ok");
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });

  it("recovers when static i18n rewrites the logs container text", async () => {
    vi.useFakeTimers();
    mocks.idbGetLogs.mockResolvedValue([]);
    mocks.applyStaticI18n.mockImplementationOnce(() => {
      const logsEl = globalThis.document.getElementById("logs");
      logsEl.textContent = UI_MESSAGES.logs.loading;
    });

    await import("../src/pages/logs/logs.js");
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    const statusEl = globalThis.document.getElementById("status");
    const logsEl = globalThis.document.getElementById("logs");
    const logsContentEl = logsEl.children[1];

    expect(statusEl.textContent).toBe(UI_MESSAGES.logs.logCount(0));
    expect(statusEl.className).toBe("status ok");
    expect(logsEl.children.length).toBe(2);
    expect(logsEl.classList.contains("empty-state")).toBe(true);
    expect(logsContentEl?.textContent).toBe(UI_MESSAGES.logs.noLogsYet);
  });
});
