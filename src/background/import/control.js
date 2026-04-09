/**
 * Import lifecycle/control state.
 * Owns single-active-import guard, cancellation/termination bookkeeping,
 * and abort-aware race helpers used across import runners.
 */
function createImportControl({
  UI_MESSAGES,
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
  safeLog,
  reportProgress,
}) {
  const importAbortControllerById = new Map();
  const terminatedImportIds = new Set();
  let activeImportRequestId = "";

  function assertCanStartImport() {
    if (activeImportRequestId) {
      throw createImportError(
        IMPORT_ERROR_CODES.concurrentImportInProgress,
        UI_MESSAGES.import.concurrentImportInProgress,
      );
    }
  }

  function throwIfTerminated(requestId, abortController = null) {
    if (
      terminatedImportIds.has(requestId) ||
      Boolean(abortController?.signal?.aborted)
    ) {
      throw createImportError(
        IMPORT_ERROR_CODES.importTerminated,
        UI_MESSAGES.import.importTerminatedError,
      );
    }
  }

  function beginImport(progressId) {
    assertCanStartImport();
    activeImportRequestId = progressId;
    const abortController = new AbortController();
    importAbortControllerById.set(progressId, abortController);
    const ensureImportActive = () => throwIfTerminated(progressId, abortController);
    return { abortController, ensureImportActive };
  }

  function endImport(progressId) {
    importAbortControllerById.delete(progressId);
    terminatedImportIds.delete(progressId);
    if (activeImportRequestId === progressId) {
      activeImportRequestId = "";
    }
  }

  function isUserTerminatedImport(requestId, abortController, error) {
    if (
      getImportErrorCode(error) === IMPORT_ERROR_CODES.importTerminated ||
      error?.message === UI_MESSAGES.import.importTerminatedError
    ) {
      return true;
    }
    // AbortError should count as user termination only when this import was
    // explicitly marked as terminated by terminateImport().
    return (
      error?.name === "AbortError" &&
      Boolean(abortController?.signal?.aborted) &&
      terminatedImportIds.has(requestId)
    );
  }

  async function raceWithImportAbort(promise, requestId, abortController = null) {
    if (!abortController?.signal) {
      return promise;
    }

    throwIfTerminated(requestId, abortController);
    let removeListener = () => {};
    const abortPromise = new Promise((_, reject) => {
      const onAbort = () => {
        reject(
          createImportError(
            IMPORT_ERROR_CODES.importTerminated,
            UI_MESSAGES.import.importTerminatedError,
          ),
        );
      };
      abortController.signal.addEventListener("abort", onAbort, { once: true });
      removeListener = () => {
        abortController.signal.removeEventListener("abort", onAbort);
      };
    });

    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      removeListener();
    }
  }

  async function terminateImport(requestId) {
    const id = String(requestId || "").trim();
    if (!id) {
      throw createImportError(
        IMPORT_ERROR_CODES.invalidUrl,
        UI_MESSAGES.import.missingRequestId,
      );
    }

    terminatedImportIds.add(id);
    const controller = importAbortControllerById.get(id);
    if (controller) {
      controller.abort();
    }

    void safeLog("import", "Terminate import requested", { requestId: id });
    void reportProgress(
      id,
      UI_MESSAGES.import.importTerminated,
      false,
      "error",
      UI_MESSAGES.import.phaseComplete,
      { messageKey: "importTerminated" },
    );
    return Boolean(controller);
  }

  return {
    beginImport,
    endImport,
    isUserTerminatedImport,
    raceWithImportAbort,
    terminateImport,
  };
}

export { createImportControl };
