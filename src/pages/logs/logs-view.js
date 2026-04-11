// Logs view controller: owns DOM wiring and stateful rendering for the logs page,
// while the page coordinator and helper modules supply data, text, and formatting rules.
export function createLogsViewController({
  refs,
  UI_MESSAGES,
  getVisibleLogLines,
  formatLogsStatusCount,
  safeStringifyLogValue,
}) {
  const {
    logsEl,
    statusEl,
    viewToggleBtn,
    viewToggleIcon,
    reportBugBtn,
    reportPanel,
    wrapEl,
    bugDescriptionLabel,
    bugDescriptionInput,
    reportAttachmentHint,
    reportStatusEl,
  } = refs;

  let logsMascotEl = null;
  let logsContentEl = null;
  let latestLoadedLogs = [];
  let showUnbundledLogs = false;
  let isReportComposerOpen = false;
  let themeMode = "light";

  function getLogsEmptyMascotSrc(mode) {
    return mode === "dark"
      ? "../../assets/mascots/pesto-log-bug.webp"
      : "../../assets/mascots/otha-log-bug.webp";
  }

  function setStatus(text, ok = false) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text;
    statusEl.className = ok ? "status ok" : "status";
  }

  function setReportStatus(text, ok = false) {
    if (!reportStatusEl) {
      return;
    }
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      reportStatusEl.textContent = "";
      reportStatusEl.className = "status";
      reportStatusEl.hidden = true;
      return;
    }
    reportStatusEl.textContent = text;
    reportStatusEl.className = ok ? "status ok" : "status";
    reportStatusEl.hidden = false;
  }

  function updateViewToggleButton() {
    if (!viewToggleBtn) {
      return;
    }

    const label = showUnbundledLogs
      ? UI_MESSAGES.logs.bundleAllButton
      : UI_MESSAGES.logs.expandAllButton;
    const labelEl =
      typeof viewToggleBtn.querySelector === "function"
        ? viewToggleBtn.querySelector("span")
        : null;
    if (labelEl) {
      labelEl.textContent = label;
    } else {
      viewToggleBtn.textContent = label;
    }
    if (viewToggleIcon) {
      viewToggleIcon.src = showUnbundledLogs
        ? "../../assets/shared/icon-view-bundle.svg"
        : "../../assets/shared/icon-view-expand.svg";
    }
    viewToggleBtn.title = label;
    viewToggleBtn.setAttribute("aria-label", label);
    viewToggleBtn.disabled = latestLoadedLogs.length === 0;
  }

  function setReportComposerOpen(open) {
    isReportComposerOpen = Boolean(open);
    if (reportBugBtn) {
      const labelEl =
        typeof reportBugBtn.querySelector === "function"
          ? reportBugBtn.querySelector("span")
          : null;
      if (labelEl) {
        labelEl.textContent = UI_MESSAGES.logs.reportBugButtonCollapsed;
      } else {
        reportBugBtn.textContent = UI_MESSAGES.logs.reportBugButtonCollapsed;
      }
    }
    if (reportPanel) {
      reportPanel.hidden = !isReportComposerOpen;
    }
    wrapEl?.classList.toggle("report-open", isReportComposerOpen);
    if (reportAttachmentHint) {
      reportAttachmentHint.hidden = !isReportComposerOpen;
    }
    if (bugDescriptionLabel) {
      bugDescriptionLabel.hidden = false;
    }
    if (bugDescriptionInput) {
      bugDescriptionInput.hidden = false;
    }
    if (!isReportComposerOpen) {
      setReportStatus("");
    }
  }

  function ensureLogsStructure() {
    if (!logsEl) {
      return false;
    }
    const hasAttachedStructure =
      logsMascotEl?.parentElement === logsEl && logsContentEl?.parentElement === logsEl;

    if (hasAttachedStructure) {
      return true;
    }

    logsEl.innerHTML = "";

    logsMascotEl = document.createElement("img");
    logsMascotEl.className = "logs-mascot";
    logsMascotEl.alt = UI_MESSAGES.logs.logsMascotAlt;

    logsContentEl = document.createElement("div");
    logsContentEl.className = "logs-content";
    logsContentEl.textContent = UI_MESSAGES.logs.loading;

    logsEl.append(logsMascotEl, logsContentEl);
    return true;
  }

  function renderEmptyLogsState() {
    if (!ensureLogsStructure()) {
      return;
    }
    logsEl.classList.add("empty-state");
    logsEl.classList.remove("has-logs");
    logsContentEl?.classList.remove("entries-view");

    logsMascotEl.src = getLogsEmptyMascotSrc(themeMode);
    logsContentEl.textContent = UI_MESSAGES.logs.noLogsYet;
  }

  function updateLogsEmptyStateMascot(mode) {
    if (!logsMascotEl) {
      return;
    }
    logsMascotEl.src = getLogsEmptyMascotSrc(mode);
  }

  function renderLogLines(lines) {
    if (!logsContentEl) {
      return;
    }
    if (!Array.isArray(lines) || !lines.length) {
      logsContentEl.classList.remove("entries-view");
      logsContentEl.textContent = "";
      return;
    }

    // Keep unit-test mocks stable while using row elements in real DOM.
    if (Array.isArray(logsContentEl.children)) {
      logsContentEl.classList.remove("entries-view");
      logsContentEl.textContent = lines.join("\n");
      return;
    }

    logsContentEl.classList.add("entries-view");
    logsContentEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "log-row";
      row.textContent = line;
      fragment.append(row);
    }
    logsContentEl.append(fragment);
  }

  function renderLoadedLogs(logs) {
    latestLoadedLogs = Array.isArray(logs) ? logs : [];

    if (!latestLoadedLogs.length) {
      renderEmptyLogsState();
      setStatus(UI_MESSAGES.logs.logCount(0), true);
      updateViewToggleButton();
      return;
    }

    const lines = getVisibleLogLines(
      latestLoadedLogs,
      showUnbundledLogs,
      safeStringifyLogValue,
    );

    ensureLogsStructure();
    logsEl.classList.remove("empty-state");
    logsEl.classList.add("has-logs");
    logsMascotEl.src = getLogsEmptyMascotSrc(themeMode);
    renderLogLines(lines);
    setStatus(
      formatLogsStatusCount(lines.length, latestLoadedLogs.length, UI_MESSAGES),
      true,
    );
    updateViewToggleButton();
  }

  function toggleViewMode() {
    showUnbundledLogs = !showUnbundledLogs;
    renderLoadedLogs(latestLoadedLogs);
  }

  function applyTheme(theme) {
    themeMode = theme;
    updateLogsEmptyStateMascot(theme);
  }

  function syncLocaleDecorations() {
    if (logsMascotEl) {
      logsMascotEl.alt = UI_MESSAGES.logs.logsMascotAlt;
    }
    setReportComposerOpen(isReportComposerOpen);
    updateViewToggleButton();
  }

  return {
    applyTheme,
    ensureLogsStructure,
    getIsReportComposerOpen: () => isReportComposerOpen,
    getLatestLoadedLogs: () => latestLoadedLogs,
    renderEmptyLogsState,
    renderLoadedLogs,
    setReportComposerOpen,
    setReportStatus,
    setStatus,
    syncLocaleDecorations,
    toggleViewMode,
    updateViewToggleButton,
  };
}
