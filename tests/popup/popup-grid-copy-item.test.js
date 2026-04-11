import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/log.js", () => ({
  safeLog: vi.fn(async () => {}),
}));

import { copyItemUrl } from "../../src/pages/popup/popup/grid/card.js";

describe("popup-grid copy item behavior", () => {
  beforeEach(() => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: {
          writeText,
        },
      },
      configurable: true,
    });
  });

  it("copies source URL when both local path and URL are present", async () => {
    const result = await copyItemUrl({
      id: "item-1",
      name: "cat.gif",
      localPath: "C:\\Users\\MONSTER\\Desktop\\cat.gif",
      mediaUrl: "https://example.com/cat.gif",
    });

    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://example.com/cat.gif",
    );
    expect(result).toMatchObject({
      ok: true,
      method: "url",
      copiedUrl: "https://example.com/cat.gif",
    });
  });

  it("returns no-source-url for local items without path or source URL", async () => {
    const result = await copyItemUrl({
      id: "item-2",
      name: "legacy-local.gif",
      sourceUrl: "",
      mediaUrl: "",
    });

    expect(globalThis.navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      method: "none",
      reason: "no-source-url",
    });
  });
});
