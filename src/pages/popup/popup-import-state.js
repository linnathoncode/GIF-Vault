export async function restoreInactiveImportState({
  importState,
  statusController,
  clearStoredImportState,
}) {
  const RESTORED_IMPORT_STATE_DURATION_MS = 5000;
  if (!importState?.text || importState.active) {
    return false;
  }

  // Clear first so stale messages cannot reappear on next popup open.
  await clearStoredImportState();
  statusController.setProgressState(null);
  statusController.showTransientStatus(
    importState.text,
    importState.kind === "success" ? "ok" : importState.kind || "",
    RESTORED_IMPORT_STATE_DURATION_MS,
    { preserveProgress: false, forceTemporary: true },
  );
  return true;
}

export function shouldClearProgressVisualsOnStorageClear({
  hasTransientStatus,
  suppressUiReset,
}) {
  return !hasTransientStatus && !suppressUiReset;
}
