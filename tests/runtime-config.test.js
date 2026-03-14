import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfig,
} from "../src/lib/runtime-config.js";

describe("runtime config normalization", () => {
  it("returns defaults for null input", () => {
    // Null/invalid persisted payload should safely collapse to defaults.
    const normalized = normalizeRuntimeConfig(null);
    expect(normalized).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("clamps and normalizes malformed values", () => {
    // Arrange: intentionally invalid values that previously risked UI breakage.
    const normalized = normalizeRuntimeConfig({
      gifConversion: {
        fps: "0",
        width: 999999,
        maxColors: "bad",
        maxDurationSeconds: -10,
      },
      popupMenu: {
        pageSize: 0,
        defaultTab: "fav",
        hoverPreviewEnabled: "0",
        hoverPreviewDelayMs: 100,
        copyFeedbackResetDelayMs: 999999,
        importProgressPercent: {
          resolving: -5,
          fetching: 101,
          checking: "58",
          converting: "not-a-number",
          saving: "88",
          idle: null,
          complete: 140,
        },
      },
    });

    // Assert: numeric values are clamped to expected bounds.
    expect(normalized.gifConversion).toEqual({
      fps: 1,
      width: 1920,
      maxColors: DEFAULT_RUNTIME_CONFIG.gifConversion.maxColors,
      maxDurationSeconds: 1,
    });

    // Assert: booleans/tabs/progress fields normalize to safe runtime values.
    expect(normalized.popupMenu).toEqual({
      pageSize: 1,
      defaultTab: "favorites",
      hoverPreviewEnabled: false,
      hoverPreviewDelayMs: 500,
      copyFeedbackResetDelayMs: 5000,
      importProgressPercent: {
        resolving: 0,
        fetching: 100,
        checking: 58,
        converting: DEFAULT_RUNTIME_CONFIG.popupMenu.importProgressPercent.converting,
        saving: 88,
        idle: DEFAULT_RUNTIME_CONFIG.popupMenu.importProgressPercent.idle,
        complete: 100,
      },
    });
  });
});
