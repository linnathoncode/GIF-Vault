import { beforeEach, describe, expect, it, vi } from "vitest";

function createMockDocument() {
  const attrs = {};
  return {
    attrs,
    documentElement: {
      setAttribute: (key, value) => {
        attrs[key] = String(value);
      },
    },
  };
}

function createMockElement(attributes = {}) {
  return {
    attributes: { ...attributes },
    textContent: "",
    getAttribute(name) {
      return this.attributes[name] || "";
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

describe("i18n helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.chrome = {
      i18n: {
        getUILanguage: vi.fn(() => "en-US"),
      },
      storage: {
        local: {
          get: vi.fn((_keys, callback) => callback({})),
          set: vi.fn((_value, callback) => callback?.()),
        },
      },
    };
    globalThis.document = createMockDocument();
  });

  it("initializes using stored locale and updates document attributes", async () => {
    globalThis.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ locale: "tr" }),
    );
    const i18n = await import("../src/lib/i18n.js");

    const result = await i18n.initializeI18n();

    expect(result.locale).toBe("tr");
    expect(i18n.getUiLocale()).toBe("tr");
    expect(globalThis.document.attrs.lang).toBe("tr");
    expect(globalThis.document.attrs["data-locale"]).toBe("tr");
    expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("falls back to detected locale and persists when storage is empty", async () => {
    globalThis.chrome.i18n.getUILanguage = vi.fn(() => "tr-TR");
    const i18n = await import("../src/lib/i18n.js");

    const result = await i18n.initializeI18n();

    expect(result.locale).toBe("tr");
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(
      { locale: "tr" },
      expect.any(Function),
    );
  });

  it("applies static i18n for text, placeholder, title, aria-label and alt", async () => {
    const i18n = await import("../src/lib/i18n.js");
    await i18n.initializeI18n({
      localeHint: "tr",
      useStoredLocale: false,
      persistDetectedLocale: false,
    });

    const textEl = createMockElement({ "data-i18n": "popup.importButtonIdle" });
    const placeholderEl = createMockElement({
      "data-i18n-placeholder": "popup.searchInputPlaceholder",
    });
    const titleEl = createMockElement({ "data-i18n-title": "popup.openOptions" });
    const ariaEl = createMockElement({
      "data-i18n-aria-label": "popup.nextPageAriaLabel",
    });
    const altEl = createMockElement({ "data-i18n-alt": "popup.brandLogoAlt" });
    const root = {
      querySelectorAll(selector) {
        if (selector === "[data-i18n]") {
          return [textEl];
        }
        if (selector === "[data-i18n-placeholder]") {
          return [placeholderEl];
        }
        if (selector === "[data-i18n-title]") {
          return [titleEl];
        }
        if (selector === "[data-i18n-aria-label]") {
          return [ariaEl];
        }
        if (selector === "[data-i18n-alt]") {
          return [altEl];
        }
        return [];
      },
    };

    i18n.applyStaticI18n(root);

    expect(textEl.textContent).toBe("Ice Aktar");
    expect(placeholderEl.attributes.placeholder).toBe("Ada veya kaynaga gore ara");
    expect(titleEl.attributes.title).toBe("Ayarlari Ac");
    expect(ariaEl.attributes["aria-label"]).toBe("Sonraki sayfa");
    expect(altEl.attributes.alt).toBe("GIF Vault logosu");
  });

  it("normalizes and stores locale via setStoredLocale", async () => {
    const i18n = await import("../src/lib/i18n.js");

    const normalized = await i18n.setStoredLocale("tr-TR");

    expect(normalized).toBe("tr");
    expect(i18n.getUiLocale()).toBe("tr");
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(
      { locale: "tr" },
      expect.any(Function),
    );
    expect(i18n.isSupportedLocale("tr-TR")).toBe(true);
    expect(i18n.isSupportedLocale("de-DE")).toBe(false);
  });
});
