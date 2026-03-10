import { idbLog } from "./db.js";

async function safeLog(stage, message, details = {}) {
  try {
    await idbLog(stage, message, details);
  } catch {
    // no-op
  }
}

export { safeLog };
