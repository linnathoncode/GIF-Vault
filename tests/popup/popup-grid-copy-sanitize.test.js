import { describe, expect, it } from "vitest";
import {
  sanitizeCopyFallbackLocalPath,
  sanitizeCopyFallbackUrl,
} from "../../src/pages/popup/popup/grid.js";

describe("popup-grid copy fallback URL sanitization", () => {
  it("accepts https urls", () => {
    expect(sanitizeCopyFallbackUrl("https://example.com/a.gif")).toBe(
      "https://example.com/a.gif",
    );
  });

  it("accepts http urls", () => {
    expect(sanitizeCopyFallbackUrl("http://example.com/a.gif")).toBe(
      "http://example.com/a.gif",
    );
  });

  it("strips control chars and still accepts safe urls", () => {
    expect(
      sanitizeCopyFallbackUrl("\u0000https://example.com/a.gif\u0008"),
    ).toBe("https://example.com/a.gif");
  });

  it("rejects non-web schemes", () => {
    expect(sanitizeCopyFallbackUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeCopyFallbackUrl("data:text/plain,hello")).toBe("");
    expect(sanitizeCopyFallbackUrl("file:///tmp/a.gif")).toBe("");
  });

  it("rejects malformed urls", () => {
    expect(sanitizeCopyFallbackUrl("not a url")).toBe("");
  });
});

describe("popup-grid copy fallback local path sanitization", () => {
  it("accepts file urls", () => {
    expect(sanitizeCopyFallbackLocalPath("file:///tmp/a.gif")).toBe(
      "file:///tmp/a.gif",
    );
  });

  it("accepts absolute local paths", () => {
    expect(sanitizeCopyFallbackLocalPath("C:\\Users\\test\\a.gif")).toBe(
      "C:\\Users\\test\\a.gif",
    );
    expect(sanitizeCopyFallbackLocalPath("\\\\server\\share\\a.gif")).toBe(
      "\\\\server\\share\\a.gif",
    );
    expect(sanitizeCopyFallbackLocalPath("/tmp/a.gif")).toBe("/tmp/a.gif");
    expect(sanitizeCopyFallbackLocalPath("folder/a.gif")).toBe("folder/a.gif");
  });

  it("rejects non-path values", () => {
    expect(sanitizeCopyFallbackLocalPath("javascript:alert(1)")).toBe("");
    expect(sanitizeCopyFallbackLocalPath("not a path")).toBe("");
  });
});
