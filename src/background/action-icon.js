import { BADGE } from "../lib/settings.js";

// Badge and toolbar icon adapters.
async function showBadgeFallback(ok) {
  try {
    await chrome.action.setBadgeBackgroundColor({
      color: ok ? BADGE.okColor : BADGE.errorColor,
    });
    await chrome.action.setBadgeText({
      text: ok ? BADGE.okText : BADGE.errorText,
    });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, BADGE.clearDelayMs);
  } catch {
    // no-op
  }
}

export { showBadgeFallback };
