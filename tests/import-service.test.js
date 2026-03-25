import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_MESSAGES } from "../src/lib/messages.js";

const mocks = vi.hoisted(() => ({
  idbSave: vi.fn(),
  idbDelete: vi.fn(),
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
  idbDelete: mocks.idbDelete,
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
  let terminateImport;
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
    mocks.idbDelete.mockResolvedValue(undefined);

    ({ importFromUrl, terminateImport } = await import("../src/background/import-service.js"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects videos over max duration before conversion call", async () => {
    await expect(importFromUrl("https://x.com/i/status/1", "")).rejects.toThrow(
      UI_MESSAGES.import.videoTooLong(15, 18.2),
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

    const progressMessages = sendMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "IMPORT_PROGRESS");
    const phases = progressMessages.map((message) => message?.phase);
    expect(phases).toContain(UI_MESSAGES.import.phaseResolving);
    expect(phases).toContain(UI_MESSAGES.import.phaseFetching);
    expect(phases).toContain(UI_MESSAGES.import.phaseChecking);
    expect(phases).toContain(UI_MESSAGES.import.phaseConverting);
    expect(phases).toContain(UI_MESSAGES.import.phaseSaving);
    expect(phases).toContain(UI_MESSAGES.import.phaseComplete);
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

  it("does not push host-access hint text into import progress updates", async () => {
    globalThis.chrome.permissions.contains.mockResolvedValue(false);

    await expect(importFromUrl("https://x.com/i/status/4", "")).rejects.toThrow(
      UI_MESSAGES.import.hostAccessRequired,
    );

    const progressMessages = sendMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "IMPORT_PROGRESS")
      .map((message) => String(message?.text || ""));

    expect(progressMessages).not.toContain(UI_MESSAGES.import.hostAccessRequired);

    const progressPhases = sendMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "IMPORT_PROGRESS")
      .map((message) => String(message?.phase || ""));
    expect(progressPhases).toContain(UI_MESSAGES.import.phaseIdle);
  });

  it("rolls back already-saved items when a later item in batch import fails", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => "image/jpeg",
          },
          blob: async () =>
            new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
        };
      }
      return {
        ok: false,
        status: 404,
        headers: {
          get: () => "image/jpeg",
        },
        blob: async () =>
          new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
      };
    });

    mocks.resolveMediaUrls.mockResolvedValue([
      "https://image.example.com/first.jpg",
      "https://image.example.com/second.jpg",
    ]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("image.example.com")) {
        return "https://image.example.com/*";
      }
      return "https://x.com/*";
    });

    await expect(importFromUrl("https://x.com/i/status/5", "")).rejects.toThrow(
      UI_MESSAGES.import.failedToFetchMedia,
    );

    expect(mocks.idbSave).toHaveBeenCalledTimes(1);
    expect(mocks.idbDelete).toHaveBeenCalledTimes(1);
  });

  it("does not roll back already-saved items on user-terminated import", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => "image/jpeg",
          },
          blob: async () =>
            new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
        };
      }

      throw new Error(UI_MESSAGES.import.importTerminatedError);
    });

    mocks.resolveMediaUrls.mockResolvedValue([
      "https://image.example.com/first.jpg",
      "https://image.example.com/second.jpg",
    ]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("image.example.com")) {
        return "https://image.example.com/*";
      }
      return "https://x.com/*";
    });

    await expect(importFromUrl("https://x.com/i/status/6", "")).rejects.toThrow(
      UI_MESSAGES.import.importTerminated,
    );

    expect(mocks.idbSave).toHaveBeenCalledTimes(1);
    expect(mocks.idbDelete).not.toHaveBeenCalled();
  });

  it("rolls back on non-user AbortError (e.g., persistence abort)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "image/jpeg",
      },
      blob: async () =>
        new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
    }));

    mocks.resolveMediaUrls.mockResolvedValue([
      "https://image.example.com/first.jpg",
      "https://image.example.com/second.jpg",
    ]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("image.example.com")) {
        return "https://image.example.com/*";
      }
      return "https://x.com/*";
    });

    let saveCallCount = 0;
    mocks.idbSave.mockImplementation(async () => {
      saveCallCount += 1;
      if (saveCallCount === 2) {
        const abortError = new Error("IndexedDB transaction aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      return undefined;
    });

    await expect(importFromUrl("https://x.com/i/status/7", "")).rejects.toThrow(
      "IndexedDB transaction aborted",
    );

    expect(mocks.idbSave).toHaveBeenCalledTimes(2);
    expect(mocks.idbDelete).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent import attempts while one import is in progress", async () => {
    globalThis.fetch = vi.fn((_, init = {}) => {
      const signal = init?.signal;
      return new Promise((_, reject) => {
        const abortNow = () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        };
        if (signal?.aborted) {
          abortNow();
          return;
        }
        signal?.addEventListener("abort", abortNow, { once: true });
      });
    });

    const firstImportPromise = importFromUrl(
      "https://x.com/i/status/8",
      "",
      "request-8",
    );
    await Promise.resolve();

    await expect(
      importFromUrl("https://x.com/i/status/9", "", "request-9"),
    ).rejects.toThrow(UI_MESSAGES.import.concurrentImportInProgress);

    await expect(terminateImport("request-8")).resolves.toBe(true);
    await expect(firstImportPromise).rejects.toThrow(
      UI_MESSAGES.import.importTerminated,
    );
  });

  it("releases import lock when setup fails before progress loop", async () => {
    mocks.getRuntimeConfig.mockRejectedValueOnce(new Error("Runtime unavailable"));

    await expect(
      importFromUrl("https://x.com/i/status/10", "", "request-10"),
    ).rejects.toThrow("Runtime unavailable");

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "image/jpeg",
      },
      blob: async () => new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
    }));
    mocks.resolveMediaUrls.mockResolvedValue(["https://image.example.com/pic.jpg"]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("image.example.com")) {
        return "https://image.example.com/*";
      }
      return "https://x.com/*";
    });

    await expect(
      importFromUrl("https://x.com/i/status/11", "", "request-11"),
    ).resolves.toMatchObject({
      importedCount: 1,
    });
  });
});
