import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_MESSAGES } from "../../src/lib/messages.js";

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

vi.mock("../../src/lib/db.js", () => ({
  idbSave: mocks.idbSave,
  idbDelete: mocks.idbDelete,
}));

vi.mock("../../src/lib/runtime-config.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("../../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../../src/background/media-resolver.js", () => ({
  resolveMediaUrls: mocks.resolveMediaUrls,
  isSupportedMediaType: mocks.isSupportedMediaType,
  getReadableImportError: mocks.getReadableImportError,
  isTwitterUrl: mocks.isTwitterUrl,
}));

vi.mock("../../src/lib/ui.js", () => ({
  originPatternFromUrl: mocks.originPatternFromUrl,
}));

describe("import service long-video gate", () => {
  let importFromUrl;
  let importFromFiles;
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
        maxDownloadSizeMb: 50,
      },
    });
    mocks.resolveMediaUrls.mockResolvedValue(["https://video.example.com/clip.mp4"]);
    mocks.isSupportedMediaType.mockReturnValue(true);
    mocks.getReadableImportError.mockReturnValue("Resolved URL is not media");
    mocks.isTwitterUrl.mockReturnValue(false);
    mocks.originPatternFromUrl.mockReturnValue("https://video.example.com/*");
    mocks.idbDelete.mockResolvedValue(undefined);

    ({ importFromUrl, importFromFiles, terminateImport } = await import("../../src/background/import-service.js"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("converts supported video imports and saves result", async () => {
    sendMessageMock.mockImplementation(async (message) => {
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

  it("accepts serialized gifBuffer payloads returned from offscreen conversion", async () => {
    sendMessageMock.mockImplementation(async (message) => {
      if (message?.type === "OFFSCREEN_CONVERT_MP4") {
        return {
          ok: true,
          payload: {
            converted: true,
            mimeType: "image/gif",
            gifBuffer: { 0: 71, 1: 73, 2: 70, 3: 56, 4: 57, 5: 97, length: 6 },
          },
        };
      }
      return { ok: true };
    });

    await expect(
      importFromUrl("https://x.com/i/status/serialized-buffer", "", "request-serialized-buffer"),
    ).resolves.toMatchObject({ kind: "image", converted: true });

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

  it("maps offscreen runtime message-size failures to media-too-large message", async () => {
    sendMessageMock.mockImplementation(async (message) => {
      if (message?.type === "OFFSCREEN_CONVERT_MP4") {
        throw new Error(
          "Message exceeded maximum allowed size of 64MiB.",
        );
      }
      return { ok: true };
    });

    await expect(
      importFromUrl("https://x.com/i/status/size-limit", "", "request-size-limit"),
    ).rejects.toThrow(UI_MESSAGES.import.mediaTooLarge(50));
    expect(mocks.idbSave).not.toHaveBeenCalled();
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

  it("rejects non-http import entry URLs early", async () => {
    await expect(importFromUrl("file:///C:/temp/test.gif", "")).rejects.toThrow(
      UI_MESSAGES.popup.enterValidUrl,
    );
    expect(mocks.resolveMediaUrls).not.toHaveBeenCalled();
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("rejects non-http resolved hint URLs early", async () => {
    await expect(
      importFromUrl("https://x.com/i/status/12", "", "request-12", [
        "javascript:alert(1)",
      ]),
    ).rejects.toThrow(UI_MESSAGES.popup.enterValidUrl);
    expect(mocks.resolveMediaUrls).not.toHaveBeenCalled();
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("rejects non-http resolved URLs returned by resolver", async () => {
    mocks.resolveMediaUrls.mockResolvedValueOnce(["data:text/plain;base64,SGVsbG8="]);
    await expect(
      importFromUrl("https://x.com/i/status/13", "", "request-13"),
    ).rejects.toThrow(UI_MESSAGES.popup.enterValidUrl);
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("enforces max media size limit during download", async () => {
    const MB = 1024 * 1024;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://video.example.com/clip.mp4",
      headers: {
        get: () => "video/mp4",
      },
      blob: async () => ({ size: 60 * MB }),
    }));

    await expect(
      importFromUrl("https://x.com/i/status/14", "", "request-14"),
    ).rejects.toThrow(UI_MESSAGES.import.mediaTooLarge(50));
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("enforces max media size while streaming response chunks", async () => {
    const MB = 1024 * 1024;
    const chunk = new Uint8Array(30 * MB);
    const blobSpy = vi.fn(async () =>
      new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
    );
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://video.example.com/clip.mp4",
      headers: {
        get: () => "video/mp4",
      },
      body: {
        getReader: () => {
          let readCount = 0;
          return {
            read: async () => {
              readCount += 1;
              if (readCount <= 2) {
                return { done: false, value: chunk };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          };
        },
      },
      blob: blobSpy,
    }));

    await expect(
      importFromUrl("https://x.com/i/status/14b", "", "request-14b"),
    ).rejects.toThrow(UI_MESSAGES.import.mediaTooLarge(50));
    expect(blobSpy).not.toHaveBeenCalled();
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("re-validates redirected response URL access before reading blob", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://unauthorized.example.com/file.gif",
      headers: {
        get: () => "image/gif",
      },
      blob: async () =>
        new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/gif" }),
    }));
    mocks.resolveMediaUrls.mockResolvedValueOnce([
      "https://video.example.com/clip.gif",
    ]);
    mocks.originPatternFromUrl.mockImplementation((url) => {
      if (String(url).includes("unauthorized.example.com")) {
        return "https://unauthorized.example.com/*";
      }
      if (String(url).includes("video.example.com")) {
        return "https://video.example.com/*";
      }
      return "https://x.com/*";
    });
    globalThis.chrome.permissions.contains.mockImplementation(async ({ origins }) =>
      !origins.includes("https://unauthorized.example.com/*"),
    );

    await expect(
      importFromUrl("https://x.com/i/status/15", "", "request-15"),
    ).rejects.toThrow(UI_MESSAGES.import.hostAccessRequired);
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("rejects redirected non-http response URLs before reading blob", async () => {
    const blobSpy = vi.fn(async () =>
      new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/gif" }),
    );
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "chrome-extension://other-extension/file.gif",
      headers: {
        get: () => "image/gif",
      },
      blob: blobSpy,
    }));
    mocks.resolveMediaUrls.mockResolvedValueOnce([
      "https://video.example.com/clip.gif",
    ]);

    await expect(
      importFromUrl("https://x.com/i/status/16", "", "request-16"),
    ).rejects.toThrow(UI_MESSAGES.popup.enterValidUrl);
    expect(blobSpy).not.toHaveBeenCalled();
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("imports local file selections without resolver/fetch", async () => {
    const localGif = new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])], {
      type: "image/gif",
    });
    Object.defineProperty(localGif, "name", {
      value: "local-cat.gif",
      configurable: true,
    });

    await expect(importFromFiles([localGif], "request-local-1")).resolves.toMatchObject({
      importedCount: 1,
      convertedCount: 0,
    });
    expect(mocks.resolveMediaUrls).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.idbSave).toHaveBeenCalledTimes(1);
  });

  it("rejects empty local file selections early", async () => {
    await expect(importFromFiles([], "request-local-empty")).rejects.toThrow(
      UI_MESSAGES.popup.chooseFilesFirst,
    );
    expect(mocks.resolveMediaUrls).not.toHaveBeenCalled();
    expect(mocks.idbSave).not.toHaveBeenCalled();
  });

  it("imports serialized local file payloads from runtime messages", async () => {
    const bytesBase64 = "R0lGODlh";
    await expect(
      importFromFiles(
        [
          {
            name: "from-popup.gif",
            mimeType: "image/gif",
            localPath: "C:\\Users\\MONSTER\\Desktop\\from-popup.gif",
            bytesBase64,
          },
        ],
        "request-local-serialized-1",
      ),
    ).resolves.toMatchObject({
      importedCount: 1,
      convertedCount: 0,
    });
    expect(mocks.idbSave).toHaveBeenCalledTimes(1);
    const savedItem = mocks.idbSave.mock.calls[0]?.[0] || {};
    expect(savedItem.localPath).toBe("C:\\Users\\MONSTER\\Desktop\\from-popup.gif");
  });

  it("applies drop sourceUrlHint for local file imports when provided", async () => {
    const localGif = new Blob([new Uint8Array([71, 73, 70, 56, 57, 97])], {
      type: "image/gif",
    });
    Object.defineProperty(localGif, "name", {
      value: "drop-from-web.gif",
      configurable: true,
    });

    await expect(
      importFromFiles(
        [localGif],
        "request-local-with-source-hint",
        "https://example.com/media/drop-from-web.gif",
      ),
    ).resolves.toMatchObject({
      importedCount: 1,
    });

    const savedItem = mocks.idbSave.mock.calls.at(-1)?.[0] || {};
    expect(savedItem.sourceUrl).toBe("https://example.com/media/drop-from-web.gif");
  });
});
