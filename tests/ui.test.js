import { describe, expect, it } from "vitest";
import {
  hostFromUrl,
  isValidUrl,
  originPatternFromUrl,
} from "../src/lib/ui.js";

describe("ui URL helpers", () => {
  it("validates and trims manual import URLs", () => {
    // Import accepts only normalized HTTP(S) URLs.
    expect(isValidUrl("   https://example.com/file.gif   ")).toBe(true);
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("ftp://example.com/file.gif")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("builds permission origin patterns only for http/https", () => {
    // Permission prompts should never be built from non-web schemes.
    expect(originPatternFromUrl("https://media.example.com/path/file.gif")).toBe(
      "https://media.example.com/*",
    );
    expect(originPatternFromUrl("http://media.example.com/path/file.gif")).toBe(
      "http://media.example.com/*",
    );
    expect(originPatternFromUrl("file:///tmp/test.gif")).toBe("");
    expect(originPatternFromUrl("bad-url")).toBe("");
  });

  it("falls back to raw input when host extraction cannot parse a URL", () => {
    // UI helper should remain resilient for non-URL display values.
    expect(hostFromUrl("https://example.com/path")).toBe("example.com");
    expect(hostFromUrl("not-a-url")).toBe("not-a-url");
  });
});
