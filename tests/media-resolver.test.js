import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
} from "../src/background/media-resolver.js";

function makeResponse({ ok = true, url = "", text = "", json = {} } = {}) {
  // Minimal fetch-like response helper for deterministic network-path tests.
  return {
    ok,
    url,
    text: async () => text,
    json: async () => json,
  };
}

describe("media resolver", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("detects supported media and twitter hosts", () => {
    // Host detection should include Twitter/X and twimg delivery domains.
    expect(isTwitterUrl("https://x.com/user/status/123")).toBe(true);
    expect(isTwitterUrl("https://video.twimg.com/ext_tw_video/abc.mp4")).toBe(true);
    expect(isTwitterUrl("https://example.com")).toBe(false);

    // Content-type gate should only allow image/video and octet-stream.
    expect(isSupportedMediaType("image/gif")).toBe(true);
    expect(isSupportedMediaType("video/mp4")).toBe(true);
    expect(isSupportedMediaType("application/octet-stream")).toBe(true);
    expect(isSupportedMediaType("text/html")).toBe(false);
  });

  it("maps readable import errors by content and source type", () => {
    // HTML response means user likely provided a page URL, not direct media.
    expect(
      getReadableImportError("https://example.com", "text/html; charset=utf-8"),
    ).toBe("Please enter a valid URL.");
    // Twitter/X failures should be mapped to a friendlier resolver message.
    expect(getReadableImportError("https://x.com/i/status/123", "application/json")).toBe(
      "Could not resolve media from that post URL.",
    );
    expect(
      getReadableImportError("https://example.com/file.txt", "application/json"),
    ).toBe("Resolved URL is not media (application/json)");
  });

  it("returns direct media URLs without fetch", async () => {
    // Arrange
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // Act
    const input = "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/test.mp4";
    await expect(resolveMediaUrl(input)).resolves.toBe(input);
    // Assert: direct media should bypass all network expansion/resolution work.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves tweet URLs from syndication and picks highest resolution", async () => {
    // Arrange: syndication returns multiple MP4 variants.
    const statusUrl = "https://x.com/user/status/1234567890";
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: {
              variants: [
                "https://video.twimg.com/ext_tw_video/1/pu/vid/320x180/a.mp4",
                "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4",
              ],
            },
          },
        });
      }
      return makeResponse({ ok: false });
    });

    // Act
    const resolved = await resolveMediaUrl(statusUrl);
    // Assert: highest resolution variant should be selected.
    expect(resolved).toBe("https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4");
    // Regression check: avoid extra direct-status expansion fetch roundtrip.
    expect(globalThis.fetch).not.toHaveBeenCalledWith(statusUrl);
  });

  it("falls back to page scraping when syndication fails", async () => {
    // Arrange: force syndication miss, then provide page text with escaped URL.
    globalThis.fetch = vi.fn(async (url) => {
      const asString = String(url);
      if (asString.includes("cdn.syndication.twimg.com")) {
        return makeResponse({ ok: false });
      }
      if (asString.includes("api.fxtwitter.com/status/987654321")) {
        return makeResponse({
          ok: true,
          text:
            '"https:\\/\\/video.twimg.com\\/ext_tw_video\\/1\\/pu\\/vid\\/640x360\\/b.mp4?tag=12\\u0026foo=bar"',
        });
      }
      return makeResponse({ ok: false, text: "" });
    });

    // Act
    const resolved = await resolveMediaUrl("https://x.com/user/status/987654321");
    // Assert: escaped entities should be normalized in the extracted media URL.
    expect(resolved).toBe(
      "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/b.mp4?tag=12&foo=bar",
    );
  });

  it("keeps invalid-url messaging precedence over twitter-specific messaging", () => {
    // HTML should always map to the invalid-url prompt, even for Twitter hosts.
    expect(
      getReadableImportError("https://x.com/user/status/123", "text/html"),
    ).toBe("Please enter a valid URL.");
  });
});
