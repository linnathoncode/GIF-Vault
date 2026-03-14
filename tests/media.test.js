import { describe, expect, it } from "vitest";
import { extensionFromUrl, fileExtensionFromMime } from "../src/lib/media.js";

describe("media extension inference", () => {
  it("prefers URL extension when present", () => {
    // URL extension should win over MIME when explicit and supported.
    expect(extensionFromUrl("https://example.com/path/file.jpeg", "image/gif")).toBe(
      "jpg",
    );
    expect(extensionFromUrl("https://example.com/path/file.webm", "image/png")).toBe(
      "webm",
    );
  });

  it("falls back to MIME when URL is invalid or extension is unknown", () => {
    // Fallback path covers malformed URLs and unknown extensions.
    expect(extensionFromUrl("not-a-url", "video/mp4")).toBe("mp4");
    expect(extensionFromUrl("https://example.com/path/file.unknown", "image/png")).toBe(
      "png",
    );
  });

  it("returns bin for unsupported MIME", () => {
    // Unknown or empty MIME should resolve to generic binary extension.
    expect(fileExtensionFromMime("application/octet-stream")).toBe("bin");
    expect(fileExtensionFromMime("")).toBe("bin");
  });
});
