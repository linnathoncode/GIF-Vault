const LOG_ERROR_HINT_REGEX = /\b(failed|error|rejected|denied|invalid|missing|timeout|aborted|abort|unable|could not)\b/i;

function isErrorLikeLog(log) {
  const message = String(log?.message || "");
  if (LOG_ERROR_HINT_REGEX.test(message)) {
    return true;
  }

  const details = log?.details;
  if (!details || typeof details !== "object") {
    return false;
  }

  try {
    return LOG_ERROR_HINT_REGEX.test(JSON.stringify(details));
  } catch {
    return false;
  }
}

function formatLogLine(log, safeStringifyLogValue) {
  const when = new Date(log.createdAt || Date.now()).toLocaleTimeString();
  const details = log.details ? ` ${safeStringifyLogValue(log.details)}` : "";
  return `[${when}] ${log.stage}: ${log.message}${details}`;
}

function formatLogExportLine(log) {
  const when = new Date(log?.createdAt || Date.now()).toISOString();
  const stage = String(log?.stage || "unknown");
  const message = String(log?.message || "");
  const details = log?.details ? ` ${JSON.stringify(log.details)}` : "";
  return `[${when}] ${stage}: ${message}${details}`;
}

function formatBundledLogLine(group) {
  const latest = group[0];
  const when = new Date(latest.createdAt || Date.now()).toLocaleTimeString();
  const countSuffix = ` (x${group.length})`;
  return `[${when}] ${latest.stage}: ${latest.message}${countSuffix}`;
}

function buildUnbundledLogLines(logs, safeStringifyLogValue) {
  return logs.map((log) => formatLogLine(log, safeStringifyLogValue));
}

function buildRenderedLogLines(logs, safeStringifyLogValue) {
  const lines = [];
  for (let i = 0; i < logs.length; i += 1) {
    const current = logs[i];
    const signature = `${current.stage}\u0000${current.message}`;
    const group = [current];
    let j = i + 1;
    while (j < logs.length) {
      const candidate = logs[j];
      const candidateSignature = `${candidate.stage}\u0000${candidate.message}`;
      if (candidateSignature !== signature) {
        break;
      }
      group.push(candidate);
      j += 1;
    }

    const canBundle =
      group.length > 1 && group.every((log) => !isErrorLikeLog(log));
    if (canBundle) {
      lines.push(formatBundledLogLine(group));
    } else {
      for (const log of group) {
        lines.push(formatLogLine(log, safeStringifyLogValue));
      }
    }

    i = j - 1;
  }

  return lines;
}

function getVisibleLogLines(logs, showUnbundledLogs, safeStringifyLogValue) {
  return showUnbundledLogs
    ? buildUnbundledLogLines(logs, safeStringifyLogValue)
    : buildRenderedLogLines(logs, safeStringifyLogValue);
}

function formatLogsStatusCount(visibleCount, totalCount, UI_MESSAGES) {
  const safeVisibleCount = Math.max(0, Number(visibleCount) || 0);
  const safeTotalCount = Math.max(0, Number(totalCount) || 0);
  if (safeTotalCount > safeVisibleCount) {
    return UI_MESSAGES.logs.logCountWithTotal(safeVisibleCount, safeTotalCount);
  }
  return UI_MESSAGES.logs.logCount(safeVisibleCount);
}

export {
  formatLogExportLine,
  formatLogsStatusCount,
  getVisibleLogLines,
};
