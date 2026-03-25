import { GIF_CONVERSION } from "../lib/settings.js";
import { normalizeRuntimeConfig } from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import { UI_MESSAGES } from "../lib/messages.js";
import { initializeI18n } from "../lib/i18n.js";
import { FFmpeg } from "../vendor/@ffmpeg/ffmpeg/esm/index.js";
import { fetchFile } from "../vendor/@ffmpeg/util/esm/index.js";

const ffmpeg = new FFmpeg();
let ffmpegLoadPromise = null;
void initializeI18n();
ffmpeg.on("log", ({ message }) => {
  if (!message) {
    return;
  }
  if (message.toLowerCase().includes("error")) {
    void safeLog("offscreen", "ffmpeg log", { message });
  }
});

function isTrustedRuntimeSender(sender) {
  if (sender?.id === chrome.runtime.id) {
    return true;
  }
  if (!sender || typeof sender !== "object") {
    return true;
  }
  if ("id" in sender && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }

  const extensionBase = chrome.runtime.getURL("");
  const extensionOrigin = new URL(extensionBase).origin;
  const senderUrl = String(sender?.url || "");
  const senderOrigin = String(sender?.origin || "");

  return senderUrl.startsWith(extensionBase) || senderOrigin === extensionOrigin;
}

function isRuntimeMessage(message) {
  return Boolean(message) && typeof message === "object" && !Array.isArray(message);
}

function isSerializedByteObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Blob) {
    return false;
  }

  const length = Number(value.length);
  if (!Number.isInteger(length) || length < 0) {
    return false;
  }
  if (length === 0) {
    return true;
  }

  let byteEntryCount = 0;
  for (const [key, byteValue] of Object.entries(value)) {
    if (key === "length") {
      continue;
    }
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      return false;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length) {
      return false;
    }
    if (!Number.isInteger(byteValue) || byteValue < 0 || byteValue > 255) {
      return false;
    }
    byteEntryCount += 1;
  }

  return byteEntryCount > 0;
}

function isBinaryInput(value) {
  return (
    value == null ||
    isSerializedByteObject(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function isProbeMessage(message) {
  if (!isRuntimeMessage(message) || message.type !== "OFFSCREEN_PROBE_VIDEO_DURATION") {
    return false;
  }

  if ("url" in message && typeof message.url !== "string") {
    return false;
  }
  if (
    "inputExtension" in message &&
    !["", "mp4", "webm"].includes(String(message.inputExtension || ""))
  ) {
    return false;
  }
  if ("inputBytes" in message && !isBinaryInput(message.inputBytes)) {
    return false;
  }

  return true;
}

function isConvertMessage(message) {
  if (!isRuntimeMessage(message) || message.type !== "OFFSCREEN_CONVERT_MP4") {
    return false;
  }

  if ("url" in message && typeof message.url !== "string") {
    return false;
  }
  if ("filename" in message && typeof message.filename !== "string") {
    return false;
  }
  if (
    "inputExtension" in message &&
    !["", "mp4", "webm"].includes(String(message.inputExtension || ""))
  ) {
    return false;
  }
  if ("gifConversion" in message && message.gifConversion != null && typeof message.gifConversion !== "object") {
    return false;
  }
  if ("inputBytes" in message && !isBinaryInput(message.inputBytes)) {
    return false;
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedRuntimeSender(sender) || !isRuntimeMessage(message)) {
    return;
  }

  if (message.type === "OFFSCREEN_PROBE_VIDEO_DURATION") {
    if (!isProbeMessage(message)) {
      return;
    }
    void safeLog("offscreen", "Probe request received", {
      url: message.url || "",
      hasInputBytes: Boolean(message.inputBytes),
    });
    probeDuration(message)
      .then((durationSeconds) => sendResponse({ ok: true, durationSeconds }))
      .catch(async (error) => {
        await safeLog("offscreen", "Probe routine failed", {
          error: error?.message || "unknown",
        });
        sendResponse({
          ok: false,
          error: error?.message || UI_MESSAGES.offscreen.probeFailed,
        });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_CONVERT_MP4") {
    if (!isConvertMessage(message)) {
      return;
    }
    void safeLog("offscreen", "Conversion request received", {
      url: message.url || "",
      filename: message.filename || "",
      hasInputBytes: Boolean(message.inputBytes),
    });

    convertMp4ToGif(message)
      .then(async (payload) => {
        await safeLog("offscreen", "Conversion routine completed", {
          converted: Boolean(payload?.converted),
          mimeType: payload?.mimeType || "",
          reason: payload?.reason || ""
        });
        sendResponse({ ok: true, payload });
      })
      .catch(async (error) => {
        await safeLog("offscreen", "Conversion routine failed", { error: error?.message || "unknown" });
        sendResponse({
          ok: false,
          error: error?.message || UI_MESSAGES.offscreen.conversionFailed,
        });
      });

    return true;
  }
});

async function convertMp4ToGif(message) {
  await initializeI18n();
  await ensureFfmpegLoaded();
  const gifConversion = resolveGifConversionConfig(message?.gifConversion);

  const inputExtension =
    message.inputExtension === "webm" || message.inputExtension === "mp4"
      ? message.inputExtension
      : "mp4";
  const inputName = `input-${Date.now()}.${inputExtension}`;
  const outputName = `output-${Date.now()}.gif`;

  const inputData = await getInputData(message);
  if (!(inputData instanceof Uint8Array) || inputData.length === 0) {
    throw new Error(UI_MESSAGES.offscreen.inputMediaBytesEmpty);
  }
  await safeLog("offscreen", "Starting ffmpeg conversion", {
    inputBytes: inputData.length,
    fps: gifConversion.fps,
    width: gifConversion.width,
    maxColors: gifConversion.maxColors,
    maxDownloadSizeMb: gifConversion.maxDownloadSizeMb
  });

  await ffmpeg.writeFile(inputName, inputData);

  await ffmpeg.exec([
    "-i",
    inputName,
    "-vf",
    `fps=${gifConversion.fps},scale=${gifConversion.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${gifConversion.maxColors}:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,
    "-loop",
    "0",
    outputName
  ]);

  const outputData = await ffmpeg.readFile(outputName);
  if (!(outputData instanceof Uint8Array) || outputData.length === 0) {
    throw new Error(UI_MESSAGES.offscreen.emptyGifOutput);
  }

  await safeDeleteFile(inputName);
  await safeDeleteFile(outputName);

  const gifBase64 = uint8ToBase64(outputData);
  await safeLog("offscreen", "ffmpeg conversion finished", {
    outputBytes: outputData.length,
    compressionRatio: inputData.length > 0 ? Number((outputData.length / inputData.length).toFixed(3)) : 0
  });
  return {
    converted: true,
    reason: "",
    gifBase64,
    gifByteLength: outputData.length,
    mimeType: "image/gif",
    filename: message.filename || `vault-${Date.now()}.gif`
  };
}

async function probeDuration(message) {
  await initializeI18n();
  await ensureFfmpegLoaded();

  const inputExtension =
    message.inputExtension === "webm" || message.inputExtension === "mp4"
      ? message.inputExtension
      : "mp4";
  const inputName = `input-${Date.now()}.${inputExtension}`;
  const probeName = `probe-${Date.now()}.txt`;
  const inputData = await getInputData(message);
  if (!(inputData instanceof Uint8Array) || inputData.length === 0) {
    throw new Error(UI_MESSAGES.offscreen.inputMediaBytesEmpty);
  }

  await ffmpeg.writeFile(inputName, inputData);
  try {
    return await probeVideoDuration(inputName, probeName);
  } finally {
    await safeDeleteFile(inputName);
    await safeDeleteFile(probeName);
  }
}

async function getInputData(message) {
  const inputBytes = message?.inputBytes;
  if (inputBytes instanceof Uint8Array) {
    return inputBytes;
  }
  if (inputBytes instanceof ArrayBuffer) {
    return new Uint8Array(inputBytes);
  }
  if (ArrayBuffer.isView(inputBytes)) {
    return new Uint8Array(
      inputBytes.buffer,
      inputBytes.byteOffset,
      inputBytes.byteLength,
    );
  }
  if (isSerializedByteObject(inputBytes)) {
    const length = Number(inputBytes.length);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Number(inputBytes[i] || 0);
    }
    return bytes;
  }
  if (message?.url) {
    return fetchFile(message.url);
  }
  return new Uint8Array();
}

function resolveGifConversionConfig(rawConfig) {
  const normalized = normalizeRuntimeConfig({
    gifConversion: rawConfig || GIF_CONVERSION,
  });
  return normalized.gifConversion;
}

async function ensureFfmpegLoaded() {
  if (ffmpeg.loaded) {
    return;
  }
  if (ffmpegLoadPromise) {
    await ffmpegLoadPromise;
    return;
  }

  ffmpegLoadPromise = (async () => {
    const coreURL = chrome.runtime.getURL("vendor/@ffmpeg/core/esm/ffmpeg-core.js");
    const wasmURL = chrome.runtime.getURL("vendor/@ffmpeg/core/esm/ffmpeg-core.wasm");
    await safeLog("offscreen", "Loading FFmpeg core", { coreURL });
    await ffmpeg.load({
      coreURL,
      wasmURL
    });
    await safeLog("offscreen", "FFmpeg core loaded");
  })();

  try {
    await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    await safeLog("offscreen", "FFmpeg load failed", { error: error?.message || "unknown" });
    throw error;
  }
}

async function safeDeleteFile(path) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // no-op
  }
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function probeVideoDuration(inputName, probeName) {
  await ffmpeg.ffprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputName,
    "-o",
    probeName
  ]);

  const probeData = await ffmpeg.readFile(probeName);
  const text = new TextDecoder().decode(probeData).trim();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(UI_MESSAGES.offscreen.couldNotDetermineVideoDuration);
  }
  return value;
}
