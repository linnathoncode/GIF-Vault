import { describe, expect, it } from "vitest";
import { UI_MESSAGES } from "../src/lib/messages.js";
import { createPopupStatusController } from "../src/pages/popup/popup-status.js";

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
});
