export async function restoreInactiveImportState({
  importState,
  statusController,
  clearStoredImportState,
}) {
  if (!importState?.text || importState.active) {
    return false;
  }

  // Clear first so stale messages cannot reappear on next popup open.
  await clearStoredImportState();
  statusController.setProgressState(null);
  statusController.showTransientStatus(
    importState.text,
    importState.kind === "success" ? "ok" : importState.kind || "",
    2200,
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
