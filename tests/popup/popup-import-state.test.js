import { describe, expect, it, vi } from "vitest";
import {
  restoreInactiveImportState,
  shouldClearProgressVisualsOnStorageClear,
} from "../../src/pages/popup/popup-import-state.js";

describe("popup inactive import-state restore", () => {
  it("clears stored import state before showing transient restored message", async () => {
    const callOrder = [];
    const statusController = {
      setProgressState: vi.fn(() => {
        callOrder.push("setProgressState");
      }),
      showTransientStatus: vi.fn(() => {
        callOrder.push("showTransientStatus");
      }),
    };
    const clearStoredImportState = vi.fn(async () => {
      callOrder.push("clearStoredImportState");
    });

    await restoreInactiveImportState({
      importState: {
        text: "Import failed",
        kind: "error",
        active: false,
      },
      statusController,
      clearStoredImportState,
    });

    expect(callOrder.indexOf("clearStoredImportState")).toBeLessThan(
      callOrder.indexOf("showTransientStatus"),
    );
  });

  it("does not clear progress visuals when popup intentionally clears stored state", () => {
    expect(
      shouldClearProgressVisualsOnStorageClear({
        hasTransientStatus: false,
        suppressUiReset: true,
      }),
    ).toBe(false);
  });

  it("clears progress visuals for normal storage clear events", () => {
    expect(
      shouldClearProgressVisualsOnStorageClear({
        hasTransientStatus: false,
        suppressUiReset: false,
      }),
    ).toBe(true);
  });
});
