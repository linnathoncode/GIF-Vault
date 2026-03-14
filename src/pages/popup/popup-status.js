// Import progress and transient status UI.
export function createPopupStatusController({
  refs,
  state,
  getPopupMenuConfig,
}) {
  const {
    statusEl,
    progressTrackEl,
    progressBarEl,
    progressLabelEl,
    importBtn,
  } = refs;

  let transientStatusTimer = 0;
  let transientStatusActive = false;
  let transientProgressSnapshot = null;

  function getImportProgressPercent(importState) {
    if (!importState?.text) {
      return 0;
    }

    const popupMenuConfig = getPopupMenuConfig();
    if (importState.kind === "success") {
      return popupMenuConfig.importProgressPercent.complete;
    }

    const text = importState.text.toLowerCase();
    if (text.includes("saving")) {
      return popupMenuConfig.importProgressPercent.saving;
    }
    if (text.includes("checking video length")) {
      return popupMenuConfig.importProgressPercent.checking;
    }
    if (text.includes("converting")) {
      return popupMenuConfig.importProgressPercent.converting;
    }
    if (text.includes("fetching")) {
      return popupMenuConfig.importProgressPercent.fetching;
    }
    if (text.includes("resolving")) {
      return popupMenuConfig.importProgressPercent.resolving;
    }

    return importState.active
      ? popupMenuConfig.importProgressPercent.idle
      : popupMenuConfig.importProgressPercent.complete;
  }

  function clearProgressVisuals(options = {}) {
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

  function setStatus(text, kind = "") {
    if (progressLabelEl) {
      progressLabelEl.textContent = text;
    }

    let normalizedKind = "";
    if (kind === true) {
      normalizedKind = "ok";
    } else if (kind === false || kind == null) {
      normalizedKind = "";
    } else {
      normalizedKind = String(kind);
    }

    statusEl.className = normalizedKind ? `status ${normalizedKind}` : "status";
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
  }

  function showTransientStatus(
    text,
    kind = "",
    durationMs = 2000,
    options = {},
  ) {
    const hasImportStateToRestore = Boolean(state.currentImportState?.text);
    const preserveProgress =
      options.preserveProgress ?? hasImportStateToRestore;
    const forceTemporary = options.forceTemporary ?? false;
    const shouldAutoClear = preserveProgress || forceTemporary;

    transientProgressSnapshot = preserveProgress ? captureProgressVisuals() : null;
    clearTransientStatusTimer();
    transientStatusActive = shouldAutoClear;
    if (!preserveProgress) {
      clearProgressVisuals({ clearText: false });
    }
    setStatus(text, kind);

    if (!shouldAutoClear) {
      return;
    }

    transientStatusTimer = setTimeout(() => {
      transientStatusTimer = 0;
      transientStatusActive = false;
      if (state.currentImportState?.text) {
        transientProgressSnapshot = null;
        applyImportState(state.currentImportState, { force: true });
        return;
      }
      if (transientProgressSnapshot) {
        restoreProgressVisuals(transientProgressSnapshot);
        transientProgressSnapshot = null;
        return;
      }
      setStatus("");
    }, durationMs);
  }

  function applyImportState(importState, options = {}) {
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

    if (transientStatusActive && !options.force) {
      return;
    }
    if (!importState || !importState.text) {
      setProgressState(null);
      return;
    }

    const statusKind =
      importState.kind === "success" ? "ok" : importState.kind || "";
    setStatus(importState.text, statusKind);
    setProgressState(importState);
  }

  function syncImportActionButton() {
    const isActiveImport = Boolean(state.currentImportState?.active);
    importBtn.textContent = isActiveImport ? "Terminate" : "Import";
  }

  function setImportErrorState(text) {
    clearTransientStatus();
    state.currentImportState = null;
    syncImportActionButton();
    setStatus(text, "error");
    setProgressState({
      text,
      kind: "error",
      active: false,
    });
  }

  function setImportSuccessState(text) {
    clearTransientStatus();
    state.currentImportState = null;
    syncImportActionButton();
    setStatus(text, "ok");
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
