import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  idbSave: vi.fn(),
  getRuntimeConfig: vi.fn(),
  safeLog: vi.fn(),
  resolveMediaUrls: vi.fn(),
  isSupportedMediaType: vi.fn(),
  getReadableImportError: vi.fn(),
  isTwitterUrl: vi.fn(),
  originPatternFromUrl: vi.fn(),
}));

vi.mock("../src/lib/db.js", () => ({
  idbSave: mocks.idbSave,
}));

vi.mock("../src/lib/runtime-config.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../src/background/media-resolver.js", () => ({
  resolveMediaUrls: mocks.resolveMediaUrls,
  isSupportedMediaType: mocks.isSupportedMediaType,
  getReadableImportError: mocks.getReadableImportError,
  isTwitterUrl: mocks.isTwitterUrl,
}));

vi.mock("../src/lib/ui.js", () => ({
  originPatternFromUrl: mocks.originPatternFromUrl,
}));

describe("import service long-video gate", () => {
  let importFromUrl;
  let originalFetch;
  let sendMessageMock;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    originalFetch = globalThis.fetch;
    sendMessageMock = vi.fn(async (message) => {
      if (message?.type === "OFFSCREEN_PROBE_VIDEO_DURATION") {
        return { ok: true, durationSeconds: 18.2 };
      }
      if (message?.type === "OFFSCREEN_CONVERT_MP4") {
        return {
          ok: true,
          payload: {
            converted: true,
            mimeType: "image/gif",
            gifBuffer: new Uint8Array([71, 73, 70]).buffer,
          },
        };
      }
      return { ok: true };
    });

    globalThis.chrome = {
      offscreen: {
        hasDocument: vi.fn(async () => true),
        createDocument: vi.fn(async () => {}),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
      runtime: {
        sendMessage: sendMessageMock,
      },
      storage: {
        local: {
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
      },
    };

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "video/mp4",
      },
      blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" }),
    }));

    mocks.getRuntimeConfig.mockResolvedValue({
      gifConversion: {
        fps: 10,
        width: 360,
        maxColors: 96,
        maxDurationSeconds: 15,
      },
    });
    mocks.resolveMediaUrls.mockResolvedValue(["https://video.example.com/clip.mp4"]);
    mocks.isSupportedMediaType.mockReturnValue(true);
    mocks.getReadableImportError.mockReturnValue("Resolved URL is not media");
    mocks.isTwitterUrl.mockReturnValue(false);
    mocks.originPatternFromUrl.mockReturnValue("https://video.example.com/*");

    ({ importFromUrl } = await import("../src/background/import-service.js"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects videos over max duration before conversion call", async () => {
    await expect(importFromUrl("https://x.com/i/status/1", "")).rejects.toThrow(
      "Video too long (15s/18.2s). Change length limit in Options.",
    );

    const messageTypes = sendMessageMock.mock.calls.map(([msg]) => msg?.type);
    expect(messageTypes).toContain("OFFSCREEN_PROBE_VIDEO_DURATION");
    expect(messageTypes).not.toContain("OFFSCREEN_CONVERT_MP4");
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("continues to conversion when video duration is within limit", async () => {
    sendMessageMock.mockImplementation(async (message) => {
      if (message?.type === "OFFSCREEN_PROBE_VIDEO_DURATION") {
        return { ok: true, durationSeconds: 9.4 };
      }
      if (message?.type === "OFFSCREEN_CONVERT_MP4") {
        return {
          ok: true,
          payload: {
            converted: true,
            mimeType: "image/gif",
            gifBuffer: new Uint8Array([71, 73, 70, 56, 57, 97]).buffer,
          },
        };
      }
      return { ok: true };
    });

    await expect(
      importFromUrl("https://x.com/i/status/2", "", "request-1"),
    ).resolves.toMatchObject({ kind: "image", converted: true });

    const messageTypes = sendMessageMock.mock.calls.map(([msg]) => msg?.type);
    expect(messageTypes).toContain("OFFSCREEN_PROBE_VIDEO_DURATION");
    expect(messageTypes).toContain("OFFSCREEN_CONVERT_MP4");
    expect(mocks.idbSave).toHaveBeenCalledTimes(1);
  });

  it("imports all resolved media URLs from a tweet", async () => {
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: {
        get: () =>
          String(url).includes("video.example.com") ? "video/mp4" : "image/jpeg",
      },
      blob: async () =>
        String(url).includes("video.example.com")
          ? new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" })
          : new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
    }));

    sendMessageMock.mockImplementation(async (message) => {
      if (message?.type === "OFFSCREEN_PROBE_VIDEO_DURATION") {
        return { ok: true, durationSeconds: 7.4 };
      }
      if (message?.type === "OFFSCREEN_CONVERT_MP4") {
        return {
          ok: true,
          payload: {
            converted: true,
            mimeType: "image/gif",
            gifBuffer: new Uint8Array([71, 73, 70, 56, 57, 97]).buffer,
          },
        };
      }
      return { ok: true };
    });

    mocks.resolveMediaUrls.mockResolvedValue([
      "https://video.example.com/clip.mp4",
      "https://image.example.com/pic.jpg",
    ]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("video.example.com")) {
        return "https://video.example.com/*";
      }
      if (String(url).includes("image.example.com")) {
        return "https://image.example.com/*";
      }
      return "https://x.com/*";
    });

    await expect(
      importFromUrl("https://x.com/i/status/3", "", "request-3"),
    ).resolves.toMatchObject({
      importedCount: 2,
      convertedCount: 1,
    });

    expect(mocks.idbSave).toHaveBeenCalledTimes(2);
  });
});
