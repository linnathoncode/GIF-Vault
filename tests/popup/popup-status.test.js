import { describe, expect, it } from "vitest";
import { UI_MESSAGES } from "../../src/lib/messages.js";
import { createPopupStatusController } from "../../src/pages/popup/popup/status.js";

function createClassList() {
  const classes = new Set();
  return {
    add(...tokens) {
      for (const token of tokens) {
        classes.add(token);
      }
    },
    remove(...tokens) {
      for (const token of tokens) {
        classes.delete(token);
      }
    },
    toggle(token, force) {
      if (typeof force === "boolean") {
        if (force) {
          classes.add(token);
          return true;
        }
        classes.delete(token);
        return false;
      }
      if (classes.has(token)) {
        classes.delete(token);
        return false;
      }
      classes.add(token);
      return true;
    },
    contains(token) {
      return classes.has(token);
    },
  };
}

function createElement() {
  return {
    className: "",
    classList: createClassList(),
    style: { width: "" },
    textContent: "",
  };
}

function createController() {
  const refs = {
    statusEl: createElement(),
    statusTextEl: createElement(),
    progressTrackEl: createElement(),
    progressBarEl: createElement(),
    progressLabelEl: createElement(),
    importBtn: createElement(),
  };
  const state = {
    activeImportRequestId: "",
    currentImportState: null,
  };
  const getPopupMenuConfig = () => ({
    importProgressPercent: {
      resolving: 16,
      fetching: 40,
      checking: 58,
      converting: 72,
      saving: 88,
      idle: 12,
      complete: 100,
    },
  });

  const controller = createPopupStatusController({
    refs,
    state,
    getPopupMenuConfig,
  });

  return { controller, refs, state };
}

describe("popup status progress mapping", () => {
  it("uses explicit phase for progress width", () => {
    const { controller, refs } = createController();

    controller.setProgressState({
      text: "Medya getiriliyor...",
      kind: "info",
      active: true,
      phase: "fetching",
    });

    expect(refs.progressBarEl.style.width).toBe("40%");
    expect(refs.progressTrackEl.classList.contains("active")).toBe(true);
  });

  it("falls back to idle when phase is unknown and state is active", () => {
    const { controller, refs } = createController();

    controller.setProgressState({
      text: "???",
      kind: "info",
      active: true,
      phase: "unknown-phase",
    });

    expect(refs.progressBarEl.style.width).toBe("12%");
  });

  it("uses complete percent for success states without phase", () => {
    const { controller, refs } = createController();

    controller.setProgressState({
      text: "Done",
      kind: "success",
      active: false,
      phase: "",
    });

    expect(refs.progressBarEl.style.width).toBe("100%");
    expect(refs.progressTrackEl.classList.contains("ok")).toBe(true);
  });

  it("syncs import action button label from current import activity", () => {
    const { controller, refs, state } = createController();

    state.currentImportState = { active: true };
    controller.syncImportActionButton();
    expect(refs.importBtn.textContent).toBe(UI_MESSAGES.popup.importButtonTerminate);

    state.currentImportState = { active: false };
    controller.syncImportActionButton();
    expect(refs.importBtn.textContent).toBe(UI_MESSAGES.popup.importButtonIdle);
  });

  it("keeps progress label during active import and shows hints below the bar", () => {
    const { controller, refs } = createController();

    controller.applyImportState({
      text: "Importing media...",
      kind: "info",
      active: true,
      phase: "fetching",
      requestId: "r1",
    });

    controller.showTransientStatus("Deleted 1 item", "ok", 5000, {
      forceTemporary: true,
    });

    expect(refs.progressLabelEl.textContent).toBe("Importing media...");
    expect(refs.statusTextEl.textContent).toBe("Deleted 1 item");
    expect(refs.statusTextEl.className.includes("has-text")).toBe(true);
  });

  it("continues updating progress while transient hints are visible", () => {
    const { controller, refs } = createController();

    controller.applyImportState({
      text: "Resolving...",
      kind: "info",
      active: true,
      phase: "resolving",
      requestId: "r1",
    });

    controller.showTransientStatus("Deleted 1 item", "ok", 5000, {
      forceTemporary: true,
    });

    controller.applyImportState({
      text: "Fetching...",
      kind: "info",
      active: true,
      phase: "fetching",
      requestId: "r1",
    });

    expect(refs.progressLabelEl.textContent).toBe("Fetching...");
    expect(refs.progressBarEl.style.width).toBe("40%");
    expect(refs.statusTextEl.textContent).toBe("Deleted 1 item");
  });

  it("does not duplicate completed import messages below the progress bar", () => {
    const { controller, refs } = createController();

    controller.setImportSuccessState("Imported");
    expect(refs.progressLabelEl.textContent).toBe("Imported");
    expect(refs.statusTextEl.textContent).toBe("");
  });

  it("shows transient hints inline when no import is active", () => {
    const { controller, refs } = createController();

    controller.showTransientStatus("Deleted 1 item", "ok", 5000, {
      forceTemporary: true,
    });

    expect(refs.progressLabelEl.textContent).toBe("Deleted 1 item");
    expect(refs.statusTextEl.textContent).toBe("");
  });
});
