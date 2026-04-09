import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_MESSAGES } from "../../src/lib/messages.js";

const mocks = vi.hoisted(() => ({
  safeLog: vi.fn(async () => {}),
  getRuntimeConfig: vi.fn(async () => ({
    popupMenu: {},
    gifConversion: { maxDownloadSizeMb: 50 },
  })),
  normalizeRuntimeConfig: vi.fn((value) => value),
}));

vi.mock("../../src/lib/log.js", () => ({
  safeLog: mocks.safeLog,
}));

vi.mock("../../src/lib/runtime-config.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
  normalizeRuntimeConfig: mocks.normalizeRuntimeConfig,
}));

describe("popup import flow local file path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHarness() {
    const refs = {
      importInput: { value: "" },
      localFileInput: { value: "" },
    };
    const state = {
      activeImportRequestId: "",
      currentImportState: null,
    };
    const stateStore = {
      setActiveImportRequestId(requestId) {
        state.activeImportRequestId = String(requestId || "");
      },
      setImportState(importState) {
        state.currentImportState = importState?.text ? importState : null;
      },
      resetActiveImportSession: vi.fn(),
      setImportTerminationPending: vi.fn(),
      clearImportTerminationPending: vi.fn(),
    };
    const statusController = {
      clearTransientStatus: vi.fn(),
      setStatus: vi.fn(),
      setProgressState: vi.fn(),
      setImportSuccessState: vi.fn(() => {
        state.currentImportState = null;
      }),
      setImportErrorState: vi.fn(() => {
        state.currentImportState = null;
      }),
      showTransientStatus: vi.fn(),
      applyImportState: vi.fn(),
    };
    const gridController = {
      render: vi.fn(async () => {}),
    };
    const syncImportUiState = vi.fn();
    const clearStoredImportStatePreservingUi = vi.fn(async () => {});

    return {
      refs,
      state,
      stateStore,
      statusController,
      gridController,
      syncImportUiState,
      clearStoredImportStatePreservingUi,
    };
  }

  it("retries with serialized payload when native local file message is rejected as empty", async () => {
    const { createPopupImportController } = await import(
      "../../src/pages/popup/popup/import-flow.js"
    );
    const harness = createHarness();
    const file = new Blob([new Uint8Array([71, 73, 70, 56])], {
      type: "image/gif",
    });

    globalThis.chrome = {
      runtime: {
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            errorCode: "INVALID_URL",
            error: UI_MESSAGES.popup.chooseFilesFirst,
          })
          .mockResolvedValueOnce({
            ok: true,
            result: { importedCount: 1, convertedCount: 0 },
          }),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
      tabs: {
        create: vi.fn(async () => {}),
      },
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("req-local-1");

    const controller = createPopupImportController(harness);
    await controller.importFiles([file]);

    const calls = globalThis.chrome.runtime.sendMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(Array.isArray(calls[0][0].files)).toBe(true);
    expect(calls[0][0].files[0]).toBe(file);
    expect(calls[1][0].files[0]).toHaveProperty("bytesBase64");
    expect(typeof calls[1][0].files[0].bytesBase64).toBe("string");
    expect(calls[1][0].files[0].bytesBase64.length).toBeGreaterThan(0);
    expect(harness.statusController.setImportSuccessState).toHaveBeenCalledTimes(1);
    expect(harness.syncImportUiState).toHaveBeenCalled();
  });

  it("resyncs popup controls after local import failure", async () => {
    const { createPopupImportController } = await import(
      "../../src/pages/popup/popup/import-flow.js"
    );
    const harness = createHarness();
    const file = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/gif",
    });

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: false,
          errorCode: "IMPORT_FAILED",
          error: UI_MESSAGES.popup.importFailed,
        })),
      },
      permissions: {
        contains: vi.fn(async () => true),
      },
      tabs: {
        create: vi.fn(async () => {}),
      },
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("req-local-2");

    const controller = createPopupImportController(harness);
    await controller.importFiles([file]);

    expect(harness.statusController.setImportErrorState).toHaveBeenCalledTimes(1);
    expect(harness.state.activeImportRequestId).toBe("");
    expect(harness.syncImportUiState).toHaveBeenCalledTimes(2);
  });
});
