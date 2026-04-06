import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_MESSAGES } from "../../src/lib/messages.js";

const mocks = vi.hoisted(() => ({
  listener: null,
  safeLog: vi.fn(async () => {}),
  initializeI18n: vi.fn(async () => ({ locale: "en" })),
  fetchFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  ffmpegOn: vi.fn(),
  ffmpegLoad: vi.fn(async () => {}),
  ffmpegExec: vi.fn(async () => {}),
  ffmpegProbe: vi.fn(async () => {}),
  ffmpegWriteFile: vi.fn(async () => {}),
  ffmpegReadFile: vi.fn(async () => new Uint8Array([1])),
  ffmpegDeleteFile: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../../src/lib/i18n.js", () => ({
  initializeI18n: mocks.initializeI18n,
}));

vi.mock("../../src/vendor/@ffmpeg/util/esm/index.js", () => ({
  fetchFile: mocks.fetchFile,
}));

vi.mock("../../src/vendor/@ffmpeg/ffmpeg/esm/index.js", () => ({
  FFmpeg: class {
    constructor() {
      this.loaded = true;
    }
    on = mocks.ffmpegOn;
    load = mocks.ffmpegLoad;
    exec = mocks.ffmpegExec;
    ffprobe = mocks.ffmpegProbe;
    writeFile = mocks.ffmpegWriteFile;
    readFile = mocks.ffmpegReadFile;
    deleteFile = mocks.ffmpegDeleteFile;
  },
}));

describe("offscreen runtime message validation", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.listener = null;

    globalThis.chrome = {
      runtime: {
        id: "ext-id",
        getURL: vi.fn((path = "") => `chrome-extension://ext-id/${path}`),
        onMessage: {
          addListener: vi.fn((handler) => {
            mocks.listener = handler;
          }),
        },
      },
    };

    await import("../../src/offscreen/offscreen.js");
    expect(typeof mocks.listener).toBe("function");
  });

  it("ignores untrusted sender messages", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      { type: "OFFSCREEN_PROBE_VIDEO_DURATION", url: "https://example.com/a.mp4" },
      { id: "not-this-extension" },
      sendResponse,
    );

    await Promise.resolve();

    expect(handled).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(mocks.fetchFile).not.toHaveBeenCalled();
    expect(mocks.ffmpegProbe).not.toHaveBeenCalled();
    expect(mocks.ffmpegExec).not.toHaveBeenCalled();
  });

  it("ignores malformed trusted messages", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        url: { invalid: true },
      },
      { id: "ext-id" },
      sendResponse,
    );

    await Promise.resolve();

    expect(handled).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(mocks.fetchFile).not.toHaveBeenCalled();
    expect(mocks.ffmpegProbe).not.toHaveBeenCalled();
    expect(mocks.ffmpegExec).not.toHaveBeenCalled();
  });

  it("ignores trusted sender messages with unknown type", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_UNKNOWN",
        url: "https://example.com/a.mp4",
      },
      { id: "ext-id" },
      sendResponse,
    );

    await Promise.resolve();

    expect(handled).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(mocks.fetchFile).not.toHaveBeenCalled();
    expect(mocks.ffmpegProbe).not.toHaveBeenCalled();
    expect(mocks.ffmpegExec).not.toHaveBeenCalled();
  });

  it("accepts trusted extension-url sender when sender.id is missing", async () => {
    const sendResponse = vi.fn();
    mocks.fetchFile.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    mocks.ffmpegProbe.mockResolvedValueOnce(undefined);
    mocks.ffmpegReadFile.mockResolvedValueOnce(new Uint8Array([0x31, 0x2e, 0x30]));

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_PROBE_VIDEO_DURATION",
        url: "https://example.com/v.mp4",
        inputExtension: "mp4",
      },
      { url: "chrome-extension://ext-id/background/service-worker.js" },
      sendResponse,
    );

    expect(handled).toBe(true);
  });

  it("accepts object-serialized inputBytes payloads for trusted senders", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        url: "https://example.com/v.mp4",
        inputExtension: "mp4",
        inputBytes: { 0: 1, 1: 2, 2: 3, length: 3 },
      },
      { id: "ext-id" },
      sendResponse,
    );

    expect(handled).toBe(true);
  });

  it("accepts serialized inputBytes objects without explicit length", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        inputExtension: "mp4",
        inputBytes: { 0: 1, 1: 2, 2: 3 },
      },
      { id: "ext-id" },
      sendResponse,
    );

    expect(handled).toBe(true);
  });

  it("rejects malformed inputBytes objects before ffmpeg/fetch paths", async () => {
    const sendResponse = vi.fn();

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        inputExtension: "mp4",
        inputBytes: { foo: 1 },
      },
      { id: "ext-id" },
      sendResponse,
    );

    await Promise.resolve();

    expect(handled).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(mocks.fetchFile).not.toHaveBeenCalled();
    expect(mocks.ffmpegProbe).not.toHaveBeenCalled();
    expect(mocks.ffmpegExec).not.toHaveBeenCalled();
  });

  it("uses long-edge scaling without upscaling in conversion filter", async () => {
    const sendResponse = vi.fn();
    mocks.ffmpegExec.mockResolvedValueOnce(undefined);
    mocks.ffmpegReadFile.mockResolvedValueOnce(new Uint8Array([71, 73, 70]));

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        url: "https://example.com/v.mp4",
        inputExtension: "mp4",
        gifConversion: {
          fps: 10,
          width: 360,
          maxColors: 96,
          maxDownloadSizeMb: 50,
        },
      },
      { id: "ext-id" },
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(mocks.ffmpegExec).toHaveBeenCalledTimes(1);
    });
    const ffmpegArgs = mocks.ffmpegExec.mock.calls[0][0];
    const filterIndex = ffmpegArgs.indexOf("-vf");
    expect(filterIndex).toBeGreaterThan(-1);
    const filter = ffmpegArgs[filterIndex + 1];
    expect(filter).toContain("scale=if(gte(iw\\,ih)\\,min(360\\,iw)\\,-1):if(gte(iw\\,ih)\\,-1\\,min(360\\,ih)):flags=lanczos");
    expect(filter).toContain("palettegen=max_colors=96:stats_mode=full");
    expect(filter).toContain("paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle");
  });

  it("returns conversion payload as binary gifBuffer instead of base64", async () => {
    const sendResponse = vi.fn();
    mocks.ffmpegExec.mockResolvedValueOnce(undefined);
    mocks.ffmpegReadFile.mockResolvedValueOnce(new Uint8Array([71, 73, 70, 56]));

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        url: "https://example.com/v.mp4",
        inputExtension: "mp4",
      },
      { id: "ext-id" },
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const response = sendResponse.mock.calls.at(-1)?.[0];
    expect(response?.ok).toBe(true);
    expect(response?.payload?.gifBuffer instanceof ArrayBuffer).toBe(true);
    expect("gifBase64" in (response?.payload || {})).toBe(false);
  });

  it("rejects oversized converted gif payloads before runtime response", async () => {
    const MB = 1024 * 1024;
    const sendResponse = vi.fn();
    mocks.ffmpegExec.mockResolvedValueOnce(undefined);
    mocks.ffmpegReadFile.mockResolvedValueOnce(new Uint8Array((48 * MB) + 1));

    const handled = mocks.listener(
      {
        type: "OFFSCREEN_CONVERT_MP4",
        url: "https://example.com/v.mp4",
        inputExtension: "mp4",
      },
      { id: "ext-id" },
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const response = sendResponse.mock.calls.at(-1)?.[0];
    expect(response?.ok).toBe(false);
    expect(response?.error).toBe(UI_MESSAGES.import.mediaTooLarge(48));
  });
});
