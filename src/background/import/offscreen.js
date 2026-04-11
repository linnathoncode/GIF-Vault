/**
 * Offscreen conversion bridge.
 * Ensures the offscreen document exists and sends conversion requests for
 * video-to-GIF operations, translating runtime failures into import errors.
 */
import { OFFSCREEN } from "../../lib/settings.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { mediaTooLargeMessage, resolveMaxDownloadBytes } from "./media-utils.js";

const RUNTIME_MESSAGE_MAX_BYTES = 64 * 1024 * 1024;
const RUNTIME_MESSAGE_OVERHEAD_BYTES = 512 * 1024;
const RUNTIME_MESSAGE_SAFE_MAX_BYTES =
  RUNTIME_MESSAGE_MAX_BYTES - RUNTIME_MESSAGE_OVERHEAD_BYTES;
let offscreenPrewarmIssued = false;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    kickOffOffscreenPrewarm();
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN.url,
    reasons: ["BLOBS"],
    justification: "Convert imported MP4 media into GIF in background",
  });
  kickOffOffscreenPrewarm();
}

function kickOffOffscreenPrewarm() {
  if (offscreenPrewarmIssued) {
    return;
  }
  offscreenPrewarmIssued = true;
  void chrome.runtime
    .sendMessage({
      type: "OFFSCREEN_PREWARM",
    })
    .catch(() => {
      // Offscreen document may still be spinning up; conversion path lazily
      // initializes FFmpeg again if prewarm did not complete yet.
    });
}

async function convertInOffscreen({
  url,
  requestId = "",
  filename,
  inputExtension = "",
  gifConversion = null,
  inputBytes = null,
}) {
  await ensureOffscreenDocument();

  const hasInputBytes = isNonEmptyBinaryPayload(inputBytes);
  const canUseUrlFallback = isHttpUrl(url) && !isLocalPseudoUrl(url);
  const inputBytesLength = binaryPayloadByteLength(inputBytes);
  const exceedsMessageBudget =
    inputBytesLength > 0 && inputBytesLength > RUNTIME_MESSAGE_SAFE_MAX_BYTES;

  const preferUrlTransport = canUseUrlFallback;
  let includeInputBytes =
    hasInputBytes &&
    !preferUrlTransport &&
    !(exceedsMessageBudget && canUseUrlFallback);
  if (preferUrlTransport && hasInputBytes) {
    await safeLog("convert", "Using URL transport for offscreen conversion", {
      inputBytesLength,
      reason: "avoid_runtime_message_binary_serialization",
    });
  }
  if (hasInputBytes && exceedsMessageBudget && canUseUrlFallback) {
    await safeLog("convert", "Skipping input bytes payload for offscreen conversion", {
      inputBytesLength,
      safeMaxBytes: RUNTIME_MESSAGE_SAFE_MAX_BYTES,
      reason: "fallback_to_url",
    });
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_CONVERT_MP4",
      ...(includeInputBytes ? {} : { url }),
      requestId,
      filename,
      inputExtension,
      gifConversion,
      ...(includeInputBytes ? { inputBytes } : {}),
    });
  } catch (error) {
    if (
      includeInputBytes &&
      canUseUrlFallback &&
      isMessageSizeExceededError(error)
    ) {
      await safeLog("convert", "Offscreen conversion message exceeded size; retrying with URL", {
        inputBytesLength,
        safeMaxBytes: RUNTIME_MESSAGE_SAFE_MAX_BYTES,
      });
      includeInputBytes = false;
      try {
        response = await chrome.runtime.sendMessage({
          type: "OFFSCREEN_CONVERT_MP4",
          url,
          requestId,
          filename,
          inputExtension,
          gifConversion,
        });
      } catch (retryError) {
        if (isMessageSizeExceededError(retryError)) {
          throw new Error(
            mediaTooLargeMessage(
              Math.min(
                resolveMaxDownloadBytes(gifConversion),
                RUNTIME_MESSAGE_SAFE_MAX_BYTES,
              ),
            ),
          );
        }
        throw retryError;
      }
    } else if (isMessageSizeExceededError(error)) {
      throw new Error(
        mediaTooLargeMessage(
          Math.min(
            resolveMaxDownloadBytes(gifConversion),
            RUNTIME_MESSAGE_SAFE_MAX_BYTES,
          ),
        ),
      );
    } else {
      throw error;
    }
  }
  if (!response?.ok) {
    if (!includeInputBytes && hasInputBytes) {
      await safeLog("convert", "URL-based offscreen conversion failed; retrying with bytes", {
        inputBytesLength,
        error: response?.error || "unknown",
      });
      response = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_CONVERT_MP4",
        requestId,
        filename,
        inputExtension,
        gifConversion,
        inputBytes,
      });
    }
  }
  if (!response?.ok) {
    await safeLog("convert", "Offscreen conversion failed", {
      error: response?.error || "unknown",
    });
    throw new Error(response?.error || UI_MESSAGES.import.offscreenConversionFailed);
  }

  return response.payload;
}

function isNonEmptyBinaryPayload(inputBytes) {
  if (inputBytes instanceof Uint8Array) {
    return inputBytes.byteLength > 0;
  }
  if (inputBytes instanceof ArrayBuffer) {
    return inputBytes.byteLength > 0;
  }
  if (ArrayBuffer.isView(inputBytes)) {
    return inputBytes.byteLength > 0;
  }
  return false;
}

function binaryPayloadByteLength(inputBytes) {
  if (inputBytes instanceof Uint8Array) {
    return inputBytes.byteLength;
  }
  if (inputBytes instanceof ArrayBuffer) {
    return inputBytes.byteLength;
  }
  if (ArrayBuffer.isView(inputBytes)) {
    return inputBytes.byteLength;
  }
  return 0;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalPseudoUrl(value) {
  return String(value || "").startsWith("https://local.file/");
}

function isMessageSizeExceededError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("message exceeded maximum allowed size") ||
    message.includes("64mib")
  );
}

export { convertInOffscreen };
