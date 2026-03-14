import { GIF_CONVERSION } from "../lib/settings.js";
import { normalizeRuntimeConfig } from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import { FFmpeg } from "../vendor/@ffmpeg/ffmpeg/esm/index.js";
import { fetchFile } from "../vendor/@ffmpeg/util/esm/index.js";

const ffmpeg = new FFmpeg();
let ffmpegLoadPromise = null;
ffmpeg.on("log", ({ message }) => {
  if (!message) {
    return;
  }
  if (message.toLowerCase().includes("error")) {
    void safeLog("offscreen", "ffmpeg log", { message });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.type === "OFFSCREEN_PROBE_VIDEO_DURATION") {
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
        sendResponse({ ok: false, error: error?.message || "Probe failed" });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_CONVERT_MP4") {
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
        sendResponse({ ok: false, error: error?.message || "Conversion failed" });
      });

    return true;
  }
});

async function convertMp4ToGif(message) {
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
    throw new Error("Input media bytes are empty");
  }
  await safeLog("offscreen", "Starting ffmpeg conversion", {
    inputBytes: inputData.length,
    fps: gifConversion.fps,
    width: gifConversion.width,
    maxColors: gifConversion.maxColors,
    maxDurationSeconds: gifConversion.maxDurationSeconds
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
    throw new Error("FFmpeg produced empty GIF output");
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
  await ensureFfmpegLoaded();

  const inputExtension =
    message.inputExtension === "webm" || message.inputExtension === "mp4"
      ? message.inputExtension
      : "mp4";
  const inputName = `input-${Date.now()}.${inputExtension}`;
  const probeName = `probe-${Date.now()}.txt`;
  const inputData = await getInputData(message);
  if (!(inputData instanceof Uint8Array) || inputData.length === 0) {
    throw new Error("Input media bytes are empty");
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
    throw new Error("Could not determine video duration");
  }
  return value;
}
