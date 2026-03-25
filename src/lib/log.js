import { idbLog } from "./db.js";

const REDACTED_QUERY = "[REDACTED]";
const REDACTED_HASH = "[REDACTED]";

function redactUrlString(value) {
  if (typeof value !== "string") {
    return value;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    return value;
  }

  if (parsedUrl.search) {
    parsedUrl.search = `?${REDACTED_QUERY}`;
  }
  if (parsedUrl.hash) {
    parsedUrl.hash = `#${REDACTED_HASH}`;
  }

  return parsedUrl.toString();
}

function sanitizeLogValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactUrlString(value);
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value instanceof URL) {
    return redactUrlString(value.toString());
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactUrlString(value.message),
      stack: typeof value.stack === "string" ? redactUrlString(value.stack) : value.stack,
    };
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, seen));
  }

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = sanitizeLogValue(nestedValue, seen);
  }
  return output;
}

function safeStringifyLogValue(value) {
  try {
    const serialized = JSON.stringify(sanitizeLogValue(value));
    return typeof serialized === "string" ? serialized : JSON.stringify("[Unserializable]");
  } catch {
    return JSON.stringify("[Unserializable]");
  }
}

async function safeLog(stage, message, details = {}) {
  try {
    const safeDetails = sanitizeLogValue(details);
    await idbLog(stage, message, safeDetails);
  } catch {
    // no-op
  }
}

export { safeLog, safeStringifyLogValue };
