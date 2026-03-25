import { describe, expect, it } from "vitest";
import {
  extensionFromUrl,
  fileExtensionFromMime,
  getWebpAnimationState,
  isAnimatedWebpBytes,
} from "../../src/lib/media.js";

function buildWebpVp8xBytes(featureFlags) {
  const chunkSize = 10;
  const fileSize = 12 + 8 + chunkSize;
  const riffSize = fileSize - 8;
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, (riffSize >> 24) & 0xff,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58,
    chunkSize, 0x00, 0x00, 0x00,
    featureFlags, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

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

  it("detects animated webp via VP8X animation flag", () => {
    expect(isAnimatedWebpBytes(buildWebpVp8xBytes(0x02))).toBe(true);
  });

  it("does not mark static webp as animated", () => {
    expect(isAnimatedWebpBytes(buildWebpVp8xBytes(0x00))).toBe(false);
  });

  it("returns indeterminate for truncated webp chunks", () => {
    const truncated = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58,
      0x0a, 0x00, 0x00, 0x00,
      0x02, 0x00, 0x00,
    ]);
    expect(getWebpAnimationState(truncated)).toBe("indeterminate");
  });
});
