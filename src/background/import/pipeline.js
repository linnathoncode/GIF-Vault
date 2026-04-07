/**
 * Media-processing pipeline used by import runners.
 * Handles fetch/validation/conversion/save steps for both resolved remote media
 * and local-file media, plus rollback for partially saved batches.
 */
function createImportPipeline({
  idbDelete,
  idbSave,
  extensionFromUrl,
  safeLog,
  UI_MESSAGES,
  getReadableImportError,
  isSupportedMediaType,
  isTwitterUrl,
  convertInOffscreen,
  blobFromConvertedPayload,
  buildLocalPseudoUrl,
  inferName,
  inferNameFromLocalFile,
  mediaTooLargeMessage,
  normalizeHttpUrl,
  readBlobSniffBytes,
  readBlobWithMaxSize,
  resolveMaxDownloadBytes,
  ensureOriginAccess,
  reportProgress,
  notifyVaultUpdated,
  raceWithImportAbort,
}) {
  async function importResolvedMedia({
    sourceUrl,
    resolvedMediaUrl,
    pageUrl,
    progressId,
    abortController,
    gifConversionConfig,
    ensureImportActive,
  }) {
    ensureImportActive();
    const response = await fetch(resolvedMediaUrl, {
      signal: abortController.signal,
    });
    ensureImportActive();
    if (!response.ok) {
      await safeLog("fetch", "Fetch failed", {
        resolvedMediaUrl,
        status: response.status,
      });
      throw new Error(UI_MESSAGES.import.failedToFetchMedia);
    }
    await safeLog("fetch", "Fetch succeeded", {
      resolvedMediaUrl,
      status: response.status,
    });

    const finalResponseUrl = normalizeHttpUrl(response.url || resolvedMediaUrl);
    await ensureOriginAccess(finalResponseUrl);

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isBinaryFallback =
      !contentType || contentType.includes("octet-stream");
    if (
      !isBinaryFallback &&
      !isSupportedMediaType(contentType, { url: finalResponseUrl })
    ) {
      await safeLog("fetch", "Rejected non-media response", {
        resolvedMediaUrl: finalResponseUrl,
        contentType,
      });
      throw new Error(getReadableImportError(sourceUrl, contentType));
    }

    const inputBlob = await readBlobWithMaxSize(
      response,
      resolveMaxDownloadBytes(gifConversionConfig),
      ensureImportActive,
    );
    ensureImportActive();
    const sniffBytes = await readBlobSniffBytes(inputBlob);
    if (!isSupportedMediaType(contentType, { url: finalResponseUrl, sniffBytes })) {
      await safeLog("fetch", "Rejected non-media response after binary fallback checks", {
        resolvedMediaUrl: finalResponseUrl,
        contentType,
      });
      throw new Error(getReadableImportError(sourceUrl, contentType));
    }

    const ext = extensionFromUrl(finalResponseUrl, inputBlob.type);
    const isVideoMedia =
      (inputBlob.type || "").startsWith("video/") ||
      ext === "mp4" ||
      ext === "webm";

    let finalBlob = inputBlob;
    let finalMime = inputBlob.type || "image/gif";
    let converted = false;

    if (isVideoMedia) {
      await reportProgress(
        progressId,
        UI_MESSAGES.import.checkingMediaSize,
        true,
        "info",
        UI_MESSAGES.import.phaseChecking,
      );
      await safeLog("convert", "Video detected, offscreen conversion requested", {
        resolvedMediaUrl,
        sourceUrl,
        extension: ext,
        mimeType: inputBlob.type || "",
        isTwitterSource: isTwitterUrl(sourceUrl),
      });
      try {
        const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
        ensureImportActive();
        await reportProgress(
          progressId,
          UI_MESSAGES.import.convertingVideoToGif,
          true,
          "info",
          UI_MESSAGES.import.phaseConverting,
        );
        const convertedPayload = await raceWithImportAbort(
          convertInOffscreen({
            url: resolvedMediaUrl,
            requestId: progressId,
            filename: `vault-${Date.now()}.gif`,
            inputExtension: ext,
            gifConversion: gifConversionConfig,
            inputBytes,
          }),
          progressId,
          abortController,
        );
        ensureImportActive();
        const rebuiltBlob = blobFromConvertedPayload(convertedPayload);
        await safeLog("convert", "Offscreen conversion response received", {
          converted: Boolean(convertedPayload?.converted),
          mimeType: convertedPayload?.mimeType || "",
          reason: convertedPayload?.reason || "",
          hasGifBase64: Boolean(convertedPayload?.gifBase64),
          gifBase64Length: convertedPayload?.gifBase64
            ? convertedPayload.gifBase64.length
            : 0,
          gifByteLength: convertedPayload?.gifByteLength || 0,
          hasGifBuffer: Boolean(convertedPayload?.gifBuffer),
          rebuiltBlobSize: rebuiltBlob?.size || 0,
        });

        if (rebuiltBlob && rebuiltBlob.size > 0) {
          finalBlob = rebuiltBlob;
          finalMime = convertedPayload.mimeType || "image/gif";
          converted = Boolean(convertedPayload.converted);
        } else {
          await safeLog("convert", "Offscreen payload had no usable blob", {
            mimeType: convertedPayload?.mimeType || "",
            reason: convertedPayload?.reason || "",
            extension: ext,
          });
          throw new Error(UI_MESSAGES.import.offscreenConversionFailed);
        }
      } catch (error) {
        await safeLog("convert", "Offscreen conversion failed", {
          error: error?.message || "unknown",
          extension: ext,
        });
        throw new Error(error?.message || UI_MESSAGES.import.offscreenConversionFailed);
      }
    }

    await reportProgress(
      progressId,
      UI_MESSAGES.import.savingToVault,
      true,
      "info",
      UI_MESSAGES.import.phaseSaving,
    );
    ensureImportActive();
    const item = {
      id: crypto.randomUUID(),
      name: inferName(sourceUrl, resolvedMediaUrl),
      sourceUrl,
      mediaUrl: finalResponseUrl,
      pageUrl: pageUrl || "",
      mimeType: finalMime,
      kind: finalMime.startsWith("video/") ? "video" : "image",
      blob: finalBlob,
      converted,
      savedAt: Date.now(),
    };

    await idbSave(item);
    ensureImportActive();
    await safeLog("save", "Media saved to IndexedDB", {
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      blobSize: item.blob?.size || 0,
      converted: item.converted,
    });
    return item;
  }

  async function importLocalFileMedia({
    localFile,
    progressId,
    abortController,
    gifConversionConfig,
    sourceUrlHint,
    ensureImportActive,
  }) {
    ensureImportActive();
    const inputBlob = localFile.blob;
    const maxBytes = resolveMaxDownloadBytes(gifConversionConfig);
    if (inputBlob.size > maxBytes) {
      throw new Error(mediaTooLargeMessage(maxBytes));
    }

    const pseudoUrl = buildLocalPseudoUrl(localFile.name);
    const sniffBytes = await readBlobSniffBytes(inputBlob);
    const contentType = localFile.mimeType || inputBlob.type || "";
    if (!isSupportedMediaType(contentType, { url: pseudoUrl, sniffBytes })) {
      await safeLog("import", "Rejected unsupported local file", {
        fileName: localFile.name || "",
        mimeType: contentType,
        size: inputBlob.size,
      });
      throw new Error(UI_MESSAGES.import.localFileNotMedia);
    }

    const ext = extensionFromUrl(pseudoUrl, inputBlob.type || contentType);
    const isVideoMedia =
      (contentType || "").startsWith("video/") ||
      ext === "mp4" ||
      ext === "webm";

    let finalBlob = inputBlob;
    let finalMime = inputBlob.type || contentType || "image/gif";
    let converted = false;

    if (isVideoMedia) {
      await reportProgress(
        progressId,
        UI_MESSAGES.import.checkingMediaSize,
        true,
        "info",
        UI_MESSAGES.import.phaseChecking,
      );
      await safeLog("convert", "Local video detected, offscreen conversion requested", {
        fileName: localFile.name || "",
        extension: ext,
        mimeType: contentType || "",
        size: inputBlob.size,
      });
      try {
        const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
        ensureImportActive();
        await reportProgress(
          progressId,
          UI_MESSAGES.import.convertingVideoToGif,
          true,
          "info",
          UI_MESSAGES.import.phaseConverting,
        );
        const convertedPayload = await raceWithImportAbort(
          convertInOffscreen({
            url: pseudoUrl,
            requestId: progressId,
            filename: `vault-${Date.now()}.gif`,
            inputExtension: ext,
            gifConversion: gifConversionConfig,
            inputBytes,
          }),
          progressId,
          abortController,
        );
        ensureImportActive();
        const rebuiltBlob = blobFromConvertedPayload(convertedPayload);
        if (rebuiltBlob && rebuiltBlob.size > 0) {
          finalBlob = rebuiltBlob;
          finalMime = convertedPayload.mimeType || "image/gif";
          converted = Boolean(convertedPayload.converted);
        } else {
          throw new Error(UI_MESSAGES.import.offscreenConversionFailed);
        }
      } catch (error) {
        await safeLog("convert", "Local offscreen conversion failed", {
          error: error?.message || "unknown",
          extension: ext,
        });
        throw new Error(error?.message || UI_MESSAGES.import.offscreenConversionFailed);
      }
    }

    await reportProgress(
      progressId,
      UI_MESSAGES.import.savingToVault,
      true,
      "info",
      UI_MESSAGES.import.phaseSaving,
    );
    ensureImportActive();
    const item = {
      id: crypto.randomUUID(),
      name: inferNameFromLocalFile(localFile.name),
      sourceUrl: String(sourceUrlHint || "").trim(),
      mediaUrl: "",
      localPath: String(localFile.localPath || "").trim(),
      pageUrl: "",
      mimeType: finalMime,
      kind: finalMime.startsWith("video/") ? "video" : "image",
      blob: finalBlob,
      converted,
      savedAt: Date.now(),
    };

    await idbSave(item);
    ensureImportActive();
    await safeLog("save", "Local media saved to IndexedDB", {
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      blobSize: item.blob?.size || 0,
      converted: item.converted,
    });
    return item;
  }

  async function rollbackSavedItems(savedItems) {
    const items = [...savedItems].filter((item) => item?.id);
    if (items.length === 0) {
      return;
    }

    for (const item of items) {
      try {
        await idbDelete(item.id);
        await notifyVaultUpdated(item.id);
      } catch (error) {
        await safeLog("save", "Rollback delete failed", {
          id: item.id,
          error: error?.message || "unknown",
        });
      }
    }

    await safeLog("save", "Rolled back partially saved batch import", {
      rolledBackCount: items.length,
    });
  }

  return {
    importLocalFileMedia,
    importResolvedMedia,
    rollbackSavedItems,
  };
}

export { createImportPipeline };
