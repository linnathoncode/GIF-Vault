/**
 * Offscreen conversion bridge.
 * Ensures the offscreen document exists and sends conversion requests for
 * video-to-GIF operations, translating runtime failures into import errors.
 */
import { OFFSCREEN } from "../../lib/settings.js";
import { safeLog } from "../../lib/log.js";
import { UI_MESSAGES } from "../../lib/messages.js";

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN.url,
    reasons: ["BLOBS"],
    justification: "Convert imported MP4 media into GIF in background",
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
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CONVERT_MP4",
    ...(hasInputBytes ? {} : { url }),
    requestId,
    filename,
    inputExtension,
    gifConversion,
    inputBytes,
  });
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

export { convertInOffscreen };
