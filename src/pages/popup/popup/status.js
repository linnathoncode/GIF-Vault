// Import progress and transient status UI.
import { UI_MESSAGES } from "../../../lib/messages.js";

export function createPopupStatusController({
  refs,
  state = null,
  getState,
  applyImportStateToStore,
  setImportState,
  getPopupMenuConfig,
}) {
  const TRANSIENT_STATUS_DURATION_MS = 5000;
  const TERMINATION_DOT_ANIMATION_INTERVAL_MS = 450;
  const TERMINATION_DOT_FRAMES = [".", "..", "..."];
  const {
    statusEl,
    statusTextEl,
    progressTrackEl,
    progressBarEl,
    progressLabelEl,
    importBtn,
    importBtnIcon,
    importBtnLabel,
  } = refs;

  let transientStatusTimer = 0;
  let transientStatusActive = false;
  let transientProgressSnapshot = null;
  let transientDisplayMode = "below";
  let terminationDotTimer = 0;
  let terminationDotFrame = 0;
  let terminationDotBaseText = "";
  const readState =
    typeof getState === "function"
      ? getState
      : () => state || { currentImportState: null, activeImportRequestId: "" };
  const writeImportState =
    typeof setImportState === "function"
      ? setImportState
      : (importState) => {
          if (!state) {
            return;
          }
          state.currentImportState = importState?.text ? importState : null;
        };
  const applyImportStateMutation =
    typeof applyImportStateToStore === "function"
      ? applyImportStateToStore
      : (importState) => {
          if (!state) {
            return;
          }
          state.currentImportState = importState?.text ? importState : null;
          if (importState?.active) {
            state.activeImportRequestId =
              importState.requestId || state.activeImportRequestId;
          } else if (
            importState?.requestId &&
            importState.requestId === state.activeImportRequestId
          ) {
            state.activeImportRequestId = "";
          }
        };

  function normalizeTerminationBaseText(text) {
    const value = String(text || "").replace(/\u2026/g, ".").trim();
    if (!value) {
      return UI_MESSAGES.popup.importTerminationRequested.replace(/\.+$/, "");
    }
    return value.replace(/\.+$/, "").trim() || UI_MESSAGES.popup.importTerminationRequested.replace(/\.+$/, "");
  }

  function stopTerminationDotAnimation() {
    if (!terminationDotTimer) {
      return;
    }
    clearInterval(terminationDotTimer);
    terminationDotTimer = 0;
    terminationDotFrame = 0;
    terminationDotBaseText = "";
  }

  function isTerminationPendingState(importState) {
    const state = readState();
    return Boolean(state?.isImportTerminationPending && importState?.active);
  }

  function startTerminationDotAnimation(baseText) {
    const normalizedBaseText = normalizeTerminationBaseText(baseText);
    if (terminationDotTimer && terminationDotBaseText === normalizedBaseText) {
      return;
    }

    stopTerminationDotAnimation();
    terminationDotBaseText = normalizedBaseText;

    const renderFrame = () => {
      if (!progressLabelEl) {
        return;
      }

      if (!readState()?.isImportTerminationPending) {
        stopTerminationDotAnimation();
        return;
      }

      const frameSuffix =
        TERMINATION_DOT_FRAMES[
          terminationDotFrame % TERMINATION_DOT_FRAMES.length
        ];
      progressLabelEl.textContent = `${terminationDotBaseText}${frameSuffix}`;
      terminationDotFrame += 1;
    };

    renderFrame();
    terminationDotTimer = setInterval(
      renderFrame,
      TERMINATION_DOT_ANIMATION_INTERVAL_MS,
    );
  }

  function getImportProgressPercent(importState) {
    if (!importState?.text && !importState?.phase) {
      return 0;
    }

    const popupMenuConfig = getPopupMenuConfig();
    const phase = String(importState?.phase || "").trim().toLowerCase();
    if (
      phase &&
      Object.prototype.hasOwnProperty.call(
        popupMenuConfig.importProgressPercent,
        phase,
      )
    ) {
      return popupMenuConfig.importProgressPercent[phase];
    }

    if (importState.kind === "success") {
      return popupMenuConfig.importProgressPercent.complete;
    }

    return importState.active
      ? popupMenuConfig.importProgressPercent.idle
      : popupMenuConfig.importProgressPercent.complete;
  }

  function clearProgressVisuals(options = {}) {
    stopTerminationDotAnimation();
    if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
      return;
    }

    const clearText = options.clearText !== false;
    progressTrackEl.classList.remove("active", "ok", "error");
    progressBarEl.style.width = "0%";
    if (clearText) {
      progressLabelEl.textContent = "";
    }
  }

  function setProgressState(importState) {
    if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
      return;
    }

    if (!importState) {
      clearProgressVisuals();
      return;
    }

    const percent = getImportProgressPercent(importState);
    const kind = importState?.kind || "";
    const isVisible = Boolean(
      importState?.active || kind === "success" || kind === "error",
    );
    progressTrackEl.classList.toggle("active", isVisible);
    progressTrackEl.classList.toggle("ok", kind === "success");
    progressTrackEl.classList.toggle("error", kind === "error");
    progressBarEl.style.width = `${percent}%`;
    progressLabelEl.textContent = importState?.text || "";

    if (isTerminationPendingState(importState)) {
      startTerminationDotAnimation(importState?.text);
      return;
    }

    stopTerminationDotAnimation();
  }

  function captureProgressVisuals() {
    if (!progressTrackEl || !progressBarEl || !progressLabelEl) {
      return null;
    }

    return {
      active: progressTrackEl.classList.contains("active"),
      ok: progressTrackEl.classList.contains("ok"),
      error: progressTrackEl.classList.contains("error"),
      width: progressBarEl.style.width || "0%",
      text: progressLabelEl.textContent || "",
    };
  }

  function restoreProgressVisuals(snapshot) {
    if (!snapshot || !progressTrackEl || !progressBarEl || !progressLabelEl) {
      return;
    }

    progressTrackEl.classList.toggle("active", Boolean(snapshot.active));
    progressTrackEl.classList.toggle("ok", Boolean(snapshot.ok));
    progressTrackEl.classList.toggle("error", Boolean(snapshot.error));
    progressBarEl.style.width = snapshot.width || "0%";
    progressLabelEl.textContent = snapshot.text || "";
  }

  function setStatus(text, kind = "", options = {}) {
    const normalizedText = String(text || "");
    const displayMode = options.displayMode === "inline" ? "inline" : "below";
    let normalizedKind = "";
    if (kind === true) {
      normalizedKind = "ok";
    } else if (kind === false || kind == null) {
      normalizedKind = "";
    } else {
      normalizedKind = String(kind);
    }

    const classNames = ["status-text"];
    if (normalizedText) {
      classNames.push("has-text");
    }
    if (normalizedKind) {
      classNames.push(normalizedKind);
    }
    if (normalizedText.includes("\n")) {
      classNames.push("multiline");
    }

    if (displayMode === "inline") {
      if (progressLabelEl) {
        progressLabelEl.textContent = normalizedText;
      }
      if (statusTextEl) {
        statusTextEl.textContent = "";
        statusTextEl.className = "status-text";
      }
      if (statusEl) {
        statusEl.classList.remove("has-status-text");
      }
      return;
    }

    if (statusTextEl) {
      statusTextEl.textContent = normalizedText;
      statusTextEl.className = classNames.join(" ");
    }

    if (statusEl) {
      statusEl.classList.toggle("has-status-text", Boolean(normalizedText));
    }
  }

  function clearTransientStatusTimer() {
    if (!transientStatusTimer) {
      return;
    }

    clearTimeout(transientStatusTimer);
    transientStatusTimer = 0;
  }

  function clearTransientStatus() {
    transientStatusActive = false;
    clearTransientStatusTimer();
    transientProgressSnapshot = null;
    transientDisplayMode = "below";
    stopTerminationDotAnimation();
  }

  function showTransientStatus(
    text,
    kind = "",
    durationMs = TRANSIENT_STATUS_DURATION_MS,
    options = {},
  ) {
    const state = readState();
    const hasImportStateToRestore = Boolean(state.currentImportState?.text);
    const hasActiveImport = Boolean(state.currentImportState?.active);
    transientDisplayMode = hasActiveImport ? "below" : "inline";
    const preserveProgress =
      options.preserveProgress ?? (hasImportStateToRestore || hasActiveImport);
    const forceTemporary = options.forceTemporary ?? false;
    const shouldAutoClear = preserveProgress || forceTemporary;

    transientProgressSnapshot = preserveProgress ? captureProgressVisuals() : null;
    clearTransientStatusTimer();
    transientStatusActive = shouldAutoClear;
    if (!preserveProgress && !hasActiveImport) {
      clearProgressVisuals({ clearText: false });
    }
    setStatus(text, kind, { displayMode: transientDisplayMode });

    if (!shouldAutoClear) {
      return;
    }

    transientStatusTimer = setTimeout(() => {
      transientStatusTimer = 0;
      transientStatusActive = false;
      const state = readState();
      if (state.currentImportState?.text) {
        transientProgressSnapshot = null;
        applyImportState(state.currentImportState, { force: true });
        return;
      }
      if (transientProgressSnapshot) {
        restoreProgressVisuals(transientProgressSnapshot);
        transientProgressSnapshot = null;
        setStatus("");
        return;
      }
      if (transientDisplayMode === "inline" && progressLabelEl) {
        progressLabelEl.textContent = "";
      }
      setStatus("");
    }, durationMs);
  }

  function applyImportState(importState, options = {}) {
    applyImportStateMutation(importState);

    if (transientStatusActive && !options.force) {
      if (importState?.text) {
        setProgressState(importState);
      }
      return;
    }
    if (!importState || !importState.text) {
      setStatus("");
      setProgressState(null);
      return;
    }

    setStatus("");
    setProgressState(importState);
  }

  function syncImportActionButton() {
    const state = readState();
    const isActiveImport = Boolean(state.currentImportState?.active);
    const nextLabel = isActiveImport
      ? UI_MESSAGES.popup.importButtonTerminate
      : UI_MESSAGES.popup.importButtonIdle;
    const nextIcon = isActiveImport
      ? "icon-stop-import.svg"
      : "icon-import.svg";

    if (importBtnLabel) {
      importBtnLabel.textContent = nextLabel;
    } else if (importBtn) {
      importBtn.textContent = nextLabel;
    }

    if (importBtnIcon) {
      importBtnIcon.src = `../../assets/shared/${nextIcon}`;
    }
  }

  function setImportErrorState(text) {
    clearTransientStatus();
    writeImportState(null);
    syncImportActionButton();
    setStatus("");
    setProgressState({
      text,
      kind: "error",
      active: false,
    });
  }

  function setImportSuccessState(text) {
    clearTransientStatus();
    writeImportState(null);
    syncImportActionButton();
    setStatus("");
    setProgressState({
      text,
      kind: "success",
      active: false,
    });
  }

  return {
    applyImportState,
    clearTransientStatus,
    hasTransientStatus() {
      return transientStatusActive;
    },
    setImportErrorState,
    setImportSuccessState,
    setProgressState,
    setStatus,
    showTransientStatus,
    syncImportActionButton,
  };
}
