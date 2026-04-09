import { GIF_CONVERSION, STORAGE_KEYS } from "../lib/settings.js";
import { normalizeRuntimeConfig } from "../lib/runtime-config.js";
import { safeLog } from "../lib/log.js";
import { UI_MESSAGES } from "../lib/messages.js";
import { initializeI18n } from "../lib/i18n.js";
import { MESSAGE_TYPES } from "../lib/protocol.js";
import { FFmpeg } from "../vendor/@ffmpeg/ffmpeg/esm/index.js";
import { fetchFile } from "../vendor/@ffmpeg/util/esm/index.js";

const ffmpeg = new FFmpeg();
let ffmpegLoadPromise = null;
const RUNTIME_MESSAGE_MAX_BYTES = 64 * 1024 * 1024;
const RUNTIME_MESSAGE_OVERHEAD_BYTES = 512 * 1024;
const RUNTIME_MESSAGE_SAFE_MAX_BYTES =
  RUNTIME_MESSAGE_MAX_BYTES - RUNTIME_MESSAGE_OVERHEAD_BYTES;
const BASE64_TRANSPORT_SAFE_MAX_BYTES = Math.floor(
  (RUNTIME_MESSAGE_SAFE_MAX_BYTES * 3) / 4,
);
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

function parseSerializedByteObjectMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Blob) {
    return null;
  }

  const hasExplicitLength = Object.prototype.hasOwnProperty.call(value, "length");
  const explicitLength = hasExplicitLength ? Number(value.length) : -1;
  if (hasExplicitLength && (!Number.isInteger(explicitLength) || explicitLength < 0)) {
    return null;
  }

  const allowedMetaKeys = new Set([
    "length",
    "byteLength",
    "byteOffset",
    "BYTES_PER_ELEMENT",
    "buffer",
  ]);
  let byteEntryCount = 0;
  let maxIndex = -1;
  for (const [key, byteValue] of Object.entries(value)) {
    if (allowedMetaKeys.has(key)) {
      continue;
    }
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      return null;
    }
    const index = Number(key);
    if (!Number.isInteger(byteValue) || byteValue < 0 || byteValue > 255) {
      return null;
    }
    byteEntryCount += 1;
    maxIndex = Math.max(maxIndex, index);
  }

  if (hasExplicitLength) {
    if (explicitLength === 0) {
      return byteEntryCount === 0 ? { length: 0 } : null;
    }
    if (byteEntryCount !== explicitLength || maxIndex !== explicitLength - 1) {
      return null;
    }
    return { length: explicitLength };
  }

  if (byteEntryCount === 0) {
    return null;
  }
  const inferredLength = maxIndex + 1;
  if (byteEntryCount !== inferredLength) {
    return null;
  }
  return { length: inferredLength };
}

function isSerializedByteObject(value) {
  return Boolean(parseSerializedByteObjectMeta(value));
}

function deserializeSerializedByteObject(value) {
  const meta = parseSerializedByteObjectMeta(value);
  if (!meta) {
    return null;
  }

  const bytes = new Uint8Array(meta.length);
  for (let i = 0; i < meta.length; i += 1) {
    bytes[i] = Number(value[i] || 0);
  }
  return bytes;
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
  const gifConversionBase = resolveGifConversionConfig(message?.gifConversion);
  const conversionProfiles = buildGifConversionProfiles(gifConversionBase);
  const maxOutputBytes = resolveEffectiveMaxOutputBytes(gifConversionBase);

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
    profileCount: conversionProfiles.length,
    maxOutputBytes,
    maxDownloadSizeMb: gifConversionBase.maxDownloadSizeMb,
  });

  await ffmpeg.writeFile(inputName, inputData);
  try {
    for (let index = 0; index < conversionProfiles.length; index += 1) {
      const profile = conversionProfiles[index];
      const isLastProfile = index === conversionProfiles.length - 1;
      const attempt = index + 1;
      const total = conversionProfiles.length;
      await safeLog("offscreen", "Conversion attempt started", {
        attempt,
        total,
        profile,
      });

      await safeDeleteFile(outputName);
      await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        buildConversionFilter(profile),
        "-loop",
        "0",
        outputName,
      ]);

      const outputData = await ffmpeg.readFile(outputName);
      if (!(outputData instanceof Uint8Array) || outputData.length === 0) {
        throw new Error(UI_MESSAGES.offscreen.emptyGifOutput);
      }

      if (outputData.length > maxOutputBytes) {
        await safeLog("offscreen", "Converted GIF exceeded limit; lowering quality", {
          attempt,
          profile,
          outputBytes: outputData.length,
          maxOutputBytes,
          willRetry: !isLastProfile,
        });
        if (!isLastProfile) {
          await reportImportProgress({
            requestId: String(message?.requestId || ""),
            messageKey: "convertingVideoToGifDowngrade",
            messageArgs: [],
            kind: "info",
            phase: UI_MESSAGES.import.phaseConverting,
            active: true,
          });
          continue;
        }
        throw new Error(mediaTooLargeMessage(maxOutputBytes));
      }

      await safeLog("offscreen", "ffmpeg conversion finished", {
        attempt,
        profile,
        outputBytes: outputData.length,
        compressionRatio:
          inputData.length > 0
            ? Number((outputData.length / inputData.length).toFixed(3))
            : 0,
      });
      return {
        converted: true,
        reason: "",
        gifBase64: uint8ToBase64(outputData),
        gifByteLength: outputData.length,
        mimeType: "image/gif",
        filename: message.filename || `vault-${Date.now()}.gif`,
      };
    }

    throw new Error(mediaTooLargeMessage(maxOutputBytes));
  } finally {
    await safeDeleteFile(inputName);
    await safeDeleteFile(outputName);
  }
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
  const deserializedBytes = deserializeSerializedByteObject(inputBytes);
  if (deserializedBytes) {
    return deserializedBytes;
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

function resolveEffectiveMaxOutputBytes(gifConversion) {
  const configuredBytes = Math.max(
    1,
    Math.round(Number(gifConversion?.maxDownloadSizeMb || 50) * 1024 * 1024),
  );
  return Math.min(configuredBytes, BASE64_TRANSPORT_SAFE_MAX_BYTES);
}

function buildGifConversionProfiles(baseConfig) {
  const baseFps = Math.max(1, Number(baseConfig?.fps || GIF_CONVERSION.fps));
  const baseWidth = Math.max(120, Number(baseConfig?.width || GIF_CONVERSION.width));
  const baseColors = Math.max(2, Number(baseConfig?.maxColors || GIF_CONVERSION.maxColors));

  const profileCandidates = [
    { fps: baseFps, width: baseWidth, maxColors: baseColors },
    {
      fps: Math.max(1, Math.min(baseFps, Math.round(baseFps * 0.85))),
      width: Math.max(120, Math.min(baseWidth, Math.round(baseWidth * 0.85))),
      maxColors: Math.max(2, Math.min(baseColors, Math.round(baseColors * 0.8))),
    },
    {
      fps: Math.max(1, Math.min(baseFps, Math.round(baseFps * 0.7))),
      width: Math.max(120, Math.min(baseWidth, Math.round(baseWidth * 0.7))),
      maxColors: Math.max(2, Math.min(baseColors, Math.round(baseColors * 0.6))),
    },
    {
      fps: Math.max(1, Math.min(baseFps, Math.round(baseFps * 0.55))),
      width: Math.max(120, Math.min(baseWidth, Math.round(baseWidth * 0.55))),
      maxColors: Math.max(2, Math.min(baseColors, Math.round(baseColors * 0.45))),
    },
  ];

  const dedupedProfiles = [];
  const seen = new Set();
  for (const profile of profileCandidates) {
    const key = `${profile.fps}|${profile.width}|${profile.maxColors}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedProfiles.push(profile);
  }
  return dedupedProfiles;
}

function buildConversionFilter(profile) {
  // Keep the configured width as the target long-edge without upscaling.
  // This avoids portrait size blow-ups and prevents low-res inputs from being
  // enlarged into noisier GIF outputs.
  const scaleFilter = [
    `if(gte(iw\\,ih)\\,min(${profile.width}\\,iw)\\,-1)`,
    `if(gte(iw\\,ih)\\,-1\\,min(${profile.width}\\,ih))`,
    "flags=lanczos",
  ].join(":");

  return `fps=${profile.fps},scale=${scaleFilter},split[s0][s1];[s0]palettegen=max_colors=${profile.maxColors}:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
}

function mediaTooLargeMessage(maxBytes) {
  const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
  return UI_MESSAGES.import.mediaTooLarge(maxMb);
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

function resolveImportProgressText(messageKey, messageArgs) {
  const template = UI_MESSAGES.import?.[messageKey];
  if (typeof template === "function") {
    try {
      return String(template(...messageArgs));
    } catch {
      return "";
    }
  }
  if (typeof template === "string") {
    return template;
  }
  return "";
}

async function reportImportProgress({
  requestId = "",
  messageKey = "",
  messageArgs = [],
  kind = "info",
  phase = "",
  active = true,
}) {
  const normalizedMessageKey = String(messageKey || "").trim();
  const normalizedMessageArgs = Array.isArray(messageArgs) ? messageArgs : [];
  const text = resolveImportProgressText(
    normalizedMessageKey,
    normalizedMessageArgs,
  );
  const payload = {
    requestId: String(requestId || ""),
    text,
    kind: String(kind || "info"),
    phase: String(phase || ""),
    messageKey: normalizedMessageKey,
    messageArgs: normalizedMessageArgs,
    active: Boolean(active),
  };

  try {
    if (chrome.storage?.local?.set) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.importState]: {
          ...payload,
          updatedAt: Date.now(),
        },
      });
    }

    if (chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.importProgress,
        ...payload,
      });
    }
  } catch {
    // Popup may be closed while conversion runs.
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
