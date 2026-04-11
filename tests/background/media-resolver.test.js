import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  resolveMediaUrl,
  resolveMediaUrls,
} from "../../src/background/media-resolver.js";
import { UI_MESSAGES } from "../../src/lib/messages.js";

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
    expect(isTwitterUrl("https://eviltwitter.com/user/status/123")).toBe(false);
    expect(isTwitterUrl("https://x.com.evil.com/user/status/123")).toBe(false);
    expect(isTwitterUrl("https://example.com")).toBe(false);

    // Content-type gate should allow image/video directly.
    expect(isSupportedMediaType("image/gif")).toBe(true);
    expect(isSupportedMediaType("video/mp4")).toBe(true);
    expect(isSupportedMediaType("application/octet-stream")).toBe(false);
    expect(
      isSupportedMediaType("application/octet-stream", {
        url: "https://cdn.example.com/file.gif",
      }),
    ).toBe(true);
    expect(
      isSupportedMediaType("", {
        url: "https://cdn.example.com/download",
        sniffBytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      }),
    ).toBe(true);
    expect(isSupportedMediaType("text/html")).toBe(false);
    expect(
      isSupportedMediaType("application/octet-stream", {
        url: "https://cdn.example.com/download",
      }),
    ).toBe(false);
    expect(isSupportedMediaType("", { url: "data:text/plain,hello" })).toBe(false);
    expect(
      isSupportedMediaType("application/octet-stream", {
        sniffBytes: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
      }),
    ).toBe(true);
  });

  it("keeps host matching strict for trusted twitter domains", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        ok: true,
        text: '"https://video.twimg.com.evil.com/ext_tw_video/1/pu/vid/640x360/x.mp4"',
      }),
    );

    const resolved = await resolveMediaUrls("https://x.com/user/status/123456");
    expect(resolved).toEqual(["https://x.com/user/status/123456"]);
  });

  it("maps readable import errors by content and source type", () => {
    // HTML response means user likely provided a page URL, not direct media.
    expect(
      getReadableImportError("https://example.com", "text/html; charset=utf-8"),
    ).toBe(UI_MESSAGES.popup.enterValidUrl);
    // Twitter/X failures should be mapped to a friendlier resolver message.
    expect(getReadableImportError("https://x.com/i/status/123", "application/json")).toBe(
      UI_MESSAGES.import.couldNotResolveMediaFromPost,
    );
    expect(
      getReadableImportError("https://example.com/file.txt", "application/json"),
    ).toBe(UI_MESSAGES.import.resolvedUrlNotMedia("application/json"));
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

  it("resolves tweet URLs from syndication and prefers 720-quality resolution", async () => {
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
    // Assert: 720-quality variant should be selected.
    expect(resolved).toBe("https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4");
    // Regression check: avoid extra direct-status expansion fetch roundtrip.
    expect(globalThis.fetch).not.toHaveBeenCalledWith(statusUrl);
  });

  it("keeps one best URL per tweet media item when quality variants exist", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: [
              {
                variants: [
                  "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/a.mp4",
                  "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4",
                ],
              },
              {
                media_url_https: "https://pbs.twimg.com/media/ExampleId?format=jpg&name=orig",
              },
            ],
          },
        });
      }
      return makeResponse({ ok: false });
    });

    const resolved = await resolveMediaUrls("https://x.com/user/status/5555555");
    expect(resolved).toEqual([
      "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4",
      "https://pbs.twimg.com/media/ExampleId?format=jpg&name=orig",
    ]);
  });

  it("collapses codec-qualified video variants to one preferred quality variant", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: [
              {
                variants: [
                  "https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/640x360/clip.mp4?tag=12",
                  "https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/1280x720/clip.mp4?tag=12",
                  "https://video.twimg.com/ext_tw_video/42/pu/vid/h264/320x180/clip.mp4?tag=12",
                ],
              },
            ],
          },
        });
      }
      return makeResponse({ ok: false });
    });

    const resolved = await resolveMediaUrls("https://x.com/user/status/8888888");
    expect(resolved).toEqual([
      "https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/1280x720/clip.mp4?tag=12",
    ]);
  });

  it("prefers 720-quality video over higher-than-720 variants", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: [
              {
                variants: [
                  "https://video.twimg.com/ext_tw_video/7/pu/vid/640x360/preferred.mp4",
                  "https://video.twimg.com/ext_tw_video/7/pu/vid/1280x720/preferred.mp4",
                  "https://video.twimg.com/ext_tw_video/7/pu/vid/1920x1080/preferred.mp4",
                ],
              },
            ],
          },
        });
      }
      return makeResponse({ ok: false });
    });

    const resolved = await resolveMediaUrl("https://x.com/user/status/7777777");
    expect(resolved).toBe("https://video.twimg.com/ext_tw_video/7/pu/vid/1280x720/preferred.mp4");
  });

  it("excludes quoted-tweet media from syndication results", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: [
              {
                variants: [
                  "https://video.twimg.com/ext_tw_video/99/pu/vid/1280x720/main.mp4",
                ],
              },
            ],
            quoted_tweet: {
              mediaDetails: [
                {
                  variants: [
                    "https://video.twimg.com/ext_tw_video/777/pu/vid/1280x720/quoted.mp4",
                  ],
                },
              ],
            },
          },
        });
      }
      return makeResponse({ ok: false });
    });

    const resolved = await resolveMediaUrls(
      "https://twitter.com/Jaehaerys06/status/2016482330173374520",
    );
    expect(resolved).toEqual([
      "https://video.twimg.com/ext_tw_video/99/pu/vid/1280x720/main.mp4",
    ]);
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

  it("ignores quoted media in page-fallback JSON payloads", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const asString = String(url);
      if (asString.includes("cdn.syndication.twimg.com")) {
        return makeResponse({ ok: true, json: {} });
      }
      if (asString.includes("api.fxtwitter.com/status/2016482330173374520")) {
        return makeResponse({
          ok: true,
          text: JSON.stringify({
            mediaURLs: [
              "https://video.twimg.com/amplify_video/2015437264600363009/vid/avc1/720x720/main.mp4",
            ],
            qrt: {
              mediaURLs: [
                "https://pbs.twimg.com/media/G_v5-QrXMAANyas.png",
              ],
            },
          }),
        });
      }
      return makeResponse({ ok: false, text: "" });
    });

    const resolved = await resolveMediaUrls(
      "https://twitter.com/Jaehaerys06/status/2016482330173374520",
    );
    expect(resolved).toEqual([
      "https://video.twimg.com/amplify_video/2015437264600363009/vid/avc1/720x720/main.mp4",
    ]);
  });

  it("resolves tweet image media from syndication payload", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cdn.syndication.twimg.com")) {
        return makeResponse({
          ok: true,
          json: {
            mediaDetails: [
              {
                media_url_https: "https://pbs.twimg.com/media/ExampleId?format=jpg&name=orig",
              },
            ],
          },
        });
      }
      return makeResponse({ ok: false });
    });

    const resolved = await resolveMediaUrl("https://x.com/user/status/22222222");
    expect(resolved).toBe("https://pbs.twimg.com/media/ExampleId?format=jpg&name=orig");
  });

  it("keeps invalid-url messaging precedence over twitter-specific messaging", () => {
    // HTML should always map to the invalid-url prompt, even for Twitter hosts.
    expect(
      getReadableImportError("https://x.com/user/status/123", "text/html"),
    ).toBe(UI_MESSAGES.popup.enterValidUrl);
  });
});
