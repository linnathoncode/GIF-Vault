import { describe, expect, it } from "vitest";
import {
  sanitizeCopyUrl,
} from "../../src/pages/popup/popup/grid.js";

describe("popup-grid copy URL sanitization", () => {
  it("accepts https urls", () => {
    expect(sanitizeCopyUrl("https://example.com/a.gif")).toBe(
      "https://example.com/a.gif",
    );
  });

  it("accepts http urls", () => {
    expect(sanitizeCopyUrl("http://example.com/a.gif")).toBe(
      "http://example.com/a.gif",
    );
  });

  it("strips control chars and still accepts safe urls", () => {
    expect(
      sanitizeCopyUrl("\u0000https://example.com/a.gif\u0008"),
    ).toBe("https://example.com/a.gif");
  });

  it("rejects non-web schemes", () => {
    expect(sanitizeCopyUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeCopyUrl("data:text/plain,hello")).toBe("");
    expect(sanitizeCopyUrl("file:///tmp/a.gif")).toBe("");
  });

  it("rejects malformed urls", () => {
    expect(sanitizeCopyUrl("not a url")).toBe("");
  });
});
