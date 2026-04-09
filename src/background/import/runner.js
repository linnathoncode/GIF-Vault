/**
 * High-level import runners for URL and local-file flows.
 * Coordinates request lifecycle, progress phases, and error mapping while
 * delegating media work to the import pipeline module.
 */
function createImportRunner({
  getRuntimeConfig,
  safeLog,
  UI_MESSAGES,
  IMPORT_ERROR_CODES,
  createImportError,
  getImportErrorCode,
  resolveMediaUrls,
  normalizeHttpUrl,
  normalizeLocalFiles,
  normalizeOptionalHttpUrl,
  normalizeResolvedHints,
  ensureOriginAccess,
  reportProgress,
  notifyVaultUpdated,
  control,
  pipeline,
}) {
  async function importFromUrl(
    rawUrl,
    pageUrl,
    requestId = "",
    resolvedMediaUrlHint = "",
  ) {
    const progressId = requestId || crypto.randomUUID();
    const url = String(rawUrl || "").trim();
    if (!url) {
      await safeLog("import", "Rejected empty URL");
      throw createImportError(IMPORT_ERROR_CODES.invalidUrl, UI_MESSAGES.import.emptyUrl);
    }
    const normalizedUrl = normalizeHttpUrl(url);
    const { abortController, ensureImportActive } = control.beginImport(progressId);
    let resolvedHints = [];
    const savedItems = [];
    try {
      resolvedHints = normalizeResolvedHints(resolvedMediaUrlHint);
      const runtimeConfig = await getRuntimeConfig();
      const gifConversionConfig = runtimeConfig.gifConversion;

      await reportProgress(
        progressId,
        UI_MESSAGES.import.resolvingMediaUrl,
        true,
        "info",
        UI_MESSAGES.import.phaseResolving,
        { messageKey: "resolvingMediaUrl" },
      );

      ensureImportActive();
      await safeLog("import", "Import started", { url: normalizedUrl, pageUrl: pageUrl || "" });
      await ensureOriginAccess(normalizedUrl);

      const resolvedMediaUrls =
        resolvedHints.length > 0 ? resolvedHints : await resolveMediaUrls(normalizedUrl);
      ensureImportActive();
      if (!resolvedMediaUrls.length) {
        await safeLog("resolve", "Failed to resolve media URL", { url: normalizedUrl });
        throw new Error(UI_MESSAGES.import.couldNotResolveMediaUrl);
      }
      const safeResolvedMediaUrls = resolvedMediaUrls.map((candidate) =>
        normalizeHttpUrl(candidate),
      );
      await safeLog("resolve", "Resolved media URL", {
        url: normalizedUrl,
        resolvedMediaUrl: safeResolvedMediaUrls[0],
        resolvedMediaUrlCount: safeResolvedMediaUrls.length,
        reusedResolvedUrl: resolvedHints.length > 0,
      });
      for (let index = 0; index < safeResolvedMediaUrls.length; index += 1) {
        const resolvedMediaUrl = safeResolvedMediaUrls[index];
        ensureImportActive();
        await ensureOriginAccess(resolvedMediaUrl);
        const current = index + 1;
        const total = safeResolvedMediaUrls.length;
        const suffix = total > 1 ? ` (${current}/${total})` : "";
        await reportProgress(
          progressId,
          UI_MESSAGES.import.fetchingMedia(suffix),
          true,
          "info",
          UI_MESSAGES.import.phaseFetching,
          { messageKey: "fetchingMedia", messageArgs: [suffix] },
        );
        const item = await pipeline.importResolvedMedia({
          sourceUrl: normalizedUrl,
          resolvedMediaUrl,
          pageUrl,
          progressId,
          abortController,
          gifConversionConfig,
          ensureImportActive,
        });
        ensureImportActive();
        savedItems.push(item);
        await notifyVaultUpdated(item.id);
      }

      await reportProgress(
        progressId,
        savedItems.length > 1
          ? UI_MESSAGES.import.importedMany(savedItems.length)
          : UI_MESSAGES.import.importedSingle,
        false,
        "success",
        UI_MESSAGES.import.phaseComplete,
        savedItems.length > 1
          ? { messageKey: "importedMany", messageArgs: [savedItems.length] }
          : { messageKey: "importedSingle" },
      );
      return {
        id: savedItems[0]?.id || "",
        kind: savedItems[0]?.kind || "image",
        converted: savedItems.some((item) => item.converted),
        importedCount: savedItems.length,
        convertedCount: savedItems.filter((item) => item.converted).length,
      };
    } catch (error) {
      const isTerminatedError = control.isUserTerminatedImport(
        progressId,
        abortController,
        error,
      );
      const message = isTerminatedError
        ? UI_MESSAGES.import.importTerminated
        : error?.message || UI_MESSAGES.import.importFailed;
      if (savedItems.length > 0 && !isTerminatedError) {
        await pipeline.rollbackSavedItems(savedItems);
      }
      if (message === UI_MESSAGES.import.hostAccessRequired) {
        // Permission-assist flow owns this feedback; keep popup progress clear.
        await reportProgress(
          progressId,
          "",
          false,
          "info",
          UI_MESSAGES.import.phaseIdle,
          null,
        );
      } else {
        await reportProgress(
          progressId,
          message,
          false,
          "error",
          UI_MESSAGES.import.phaseComplete,
          isTerminatedError ? { messageKey: "importTerminated" } : null,
        );
      }
      throw createImportError(getImportErrorCode(error), message);
    } finally {
      control.endImport(progressId);
    }
  }

  async function importFromFiles(files, requestId = "", sourceUrlHint = "") {
    const progressId = requestId || crypto.randomUUID();
    const localFiles = normalizeLocalFiles(files);
    const normalizedSourceUrlHint = normalizeOptionalHttpUrl(sourceUrlHint);
    if (!localFiles.length) {
      await safeLog("import", "Rejected empty local file selection");
      throw createImportError(IMPORT_ERROR_CODES.invalidUrl, UI_MESSAGES.popup.chooseFilesFirst);
    }
    const { abortController, ensureImportActive } = control.beginImport(progressId);
    const savedItems = [];
    try {
      const runtimeConfig = await getRuntimeConfig();
      const gifConversionConfig = runtimeConfig.gifConversion;

      await reportProgress(
        progressId,
        UI_MESSAGES.import.readingLocalFiles(),
        true,
        "info",
        UI_MESSAGES.import.phaseFetching,
        { messageKey: "readingLocalFiles", messageArgs: [""] },
      );
      await safeLog("import", "Local file import started", {
        fileCount: localFiles.length,
      });

      for (let index = 0; index < localFiles.length; index += 1) {
        ensureImportActive();
        const current = index + 1;
        const total = localFiles.length;
        const suffix = total > 1 ? ` (${current}/${total})` : "";
        await reportProgress(
          progressId,
          UI_MESSAGES.import.readingLocalFiles(suffix),
          true,
          "info",
          UI_MESSAGES.import.phaseFetching,
          { messageKey: "readingLocalFiles", messageArgs: [suffix] },
        );

        const item = await pipeline.importLocalFileMedia({
          localFile: localFiles[index],
          progressId,
          abortController,
          gifConversionConfig,
          sourceUrlHint: normalizedSourceUrlHint,
          ensureImportActive,
        });
        ensureImportActive();
        savedItems.push(item);
        await notifyVaultUpdated(item.id);
      }

      await reportProgress(
        progressId,
        savedItems.length > 1
          ? UI_MESSAGES.import.importedMany(savedItems.length)
          : UI_MESSAGES.import.importedSingle,
        false,
        "success",
        UI_MESSAGES.import.phaseComplete,
        savedItems.length > 1
          ? { messageKey: "importedMany", messageArgs: [savedItems.length] }
          : { messageKey: "importedSingle" },
      );
      return {
        id: savedItems[0]?.id || "",
        kind: savedItems[0]?.kind || "image",
        converted: savedItems.some((item) => item.converted),
        importedCount: savedItems.length,
        convertedCount: savedItems.filter((item) => item.converted).length,
      };
    } catch (error) {
      const isTerminatedError = control.isUserTerminatedImport(
        progressId,
        abortController,
        error,
      );
      const message = isTerminatedError
        ? UI_MESSAGES.import.importTerminated
        : error?.message || UI_MESSAGES.import.importFailed;
      if (savedItems.length > 0 && !isTerminatedError) {
        await pipeline.rollbackSavedItems(savedItems);
      }
      await reportProgress(
        progressId,
        message,
        false,
        "error",
        UI_MESSAGES.import.phaseComplete,
        isTerminatedError ? { messageKey: "importTerminated" } : null,
      );
      throw createImportError(getImportErrorCode(error), message);
    } finally {
      control.endImport(progressId);
    }
  }

  return {
    importFromFiles,
    importFromUrl,
  };
}

export { createImportRunner };
