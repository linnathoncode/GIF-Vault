import { idbLog } from "../lib/db.js";
import { GIF_CONVERSION } from "../lib/settings.js";
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
  if (!message || message.type !== "OFFSCREEN_CONVERT_MP4") {
    return;
  }

  void safeLog("offscreen", "Conversion request received", {
    url: message.url || "",
    filename: message.filename || ""
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
});

async function convertMp4ToGif(message) {
  await ensureFfmpegLoaded();

  const inputName = `input-${Date.now()}.mp4`;
  const outputName = `output-${Date.now()}.gif`;
  const probeName = `probe-${Date.now()}.txt`;

  const inputData = await fetchFile(message.url);
  if (!(inputData instanceof Uint8Array) || inputData.length === 0) {
    throw new Error("Input media bytes are empty");
  }
  await safeLog("offscreen", "Starting ffmpeg conversion", {
    inputBytes: inputData.length,
    fps: GIF_CONVERSION.fps,
    width: GIF_CONVERSION.width,
    maxColors: GIF_CONVERSION.maxColors,
    maxDurationSeconds: GIF_CONVERSION.maxDurationSeconds
  });

  await ffmpeg.writeFile(inputName, inputData);
  const durationSeconds = await probeVideoDuration(inputName, probeName);
  if (durationSeconds > GIF_CONVERSION.maxDurationSeconds) {
    await safeLog("offscreen", "Rejected long video", {
      durationSeconds,
      maxDurationSeconds: GIF_CONVERSION.maxDurationSeconds
    });
    await safeDeleteFile(inputName);
    await safeDeleteFile(probeName);
    throw new Error(`VIDEO_TOO_LONG:${durationSeconds.toFixed(2)}`);
  }

  await ffmpeg.exec([
    "-i",
    inputName,
    "-vf",
    `fps=${GIF_CONVERSION.fps},scale=${GIF_CONVERSION.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${GIF_CONVERSION.maxColors}:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,
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
  await safeDeleteFile(probeName);

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

async function safeLog(stage, message, details = {}) {
  try {
    await idbLog(stage, message, details);
  } catch {
    // no-op
  }
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
