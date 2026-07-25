/**
 * Import & Backup page coordinator. Runs the selected URL or file source as a
 * sequential import queue and owns portable backup export/restore controls.
 */
import { mergeUrlLists, originPatternsForUrls, parseUrlList } from "../../lib/bulk-import.js";
import { idbGetAllMedia, idbGetMediaBlobs, idbSaveMany } from "../../lib/db.js";
import { applyStaticI18n, initializeI18n } from "../../lib/i18n.js";
import { UI_MESSAGES } from "../../lib/messages.js";
import { MESSAGE_TYPES } from "../../lib/protocol.js";
import { STORAGE_KEYS } from "../../lib/settings.js";
import { addThemeLocaleStorageListener } from "../../lib/page-lifecycle.js";
import { applyDocumentTheme, getThemeMode, setThemeMode } from "../../lib/theme.js";
import { BACKUP_MIME_TYPE, createVaultBackup, parseVaultBackup } from "../../lib/vault-backup.js";

const refs = Object.fromEntries([
  "urlListInput", "textFilesInput", "mediaFilesInput", "chooseTextFilesBtn",
  "chooseMediaFilesBtn", "textFilesSummary", "mediaFilesSummary", "startImportBtn",
  "stopImportBtn", "queueSummary", "queueProgress", "queueStatus", "resultsBody",
  "emptyResults", "exportBackupBtn", "restoreBackupBtn", "restoreBackupInput",
  "backupStatus", "themeToggleBtn", "themeToggleIcon", "urlSourcePanel",
  "fileSourcePanel",
].map((id) => [id, document.getElementById(id)]));

let textFileUrls = [];
let textFileInvalidCount = 0;
let running = false;
let stopRequested = false;
let activeRequestId = "";
let themeMode = "light";

async function startQueue() {
  const method = selectedImportMethod();
  const pasted = method === "urls"
    ? parseUrlList(refs.urlListInput.value)
    : { urls: [], invalid: [] };
  const urls = method === "urls" ? pasted.urls : textFileUrls;
  const files = method === "files" ? [...(refs.mediaFilesInput.files || [])] : [];
  const invalidCount = method === "urls" ? pasted.invalid.length : textFileInvalidCount;
  if (!urls.length && !files.length) {
    setStatus(refs.queueStatus, UI_MESSAGES.transfer.nothingToImport, "error");
    return;
  }

  const origins = originPatternsForUrls(urls);
  if (origins.length) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins });
    } catch {
      setStatus(
        refs.queueStatus,
        UI_MESSAGES.transfer.permissionRequestFailed,
        "error",
      );
      return;
    }
    if (!granted) {
      setStatus(refs.queueStatus, UI_MESSAGES.transfer.permissionDenied, "error");
      return;
    }
  }

  running = true;
  stopRequested = false;
  refs.startImportBtn.disabled = true;
  refs.stopImportBtn.disabled = false;
  refs.resultsBody.textContent = "";
  const queue = [
    ...urls.map((url) => ({ label: url, run: importUrl })),
    ...files.map((file) => ({ label: file.name, run: (_label, id) => importFile(file, id) })),
  ];
  refs.queueProgress.max = queue.length;
  refs.queueProgress.value = 0;
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < queue.length && !stopRequested; index += 1) {
    const item = queue[index];
    activeRequestId = crypto.randomUUID();
    refs.queueSummary.textContent = UI_MESSAGES.transfer.progress(index + 1, queue.length);
    setStatus(refs.queueStatus, item.label);
    try {
      const result = await item.run(item.label, activeRequestId);
      succeeded += result?.importedCount || 1;
      addResult(item.label, UI_MESSAGES.transfer.imported, true);
    } catch (error) {
      if (stopRequested) {
        addResult(item.label, UI_MESSAGES.transfer.stopped, false);
      } else {
        failed += 1;
        addResult(item.label, error?.message || UI_MESSAGES.transfer.failed, false);
      }
    } finally {
      await chrome.storage.local.remove(STORAGE_KEYS.importState);
    }
    refs.queueProgress.value = index + 1;
  }

  activeRequestId = "";
  running = false;
  refs.startImportBtn.disabled = false;
  refs.stopImportBtn.disabled = true;
  refs.queueSummary.textContent = UI_MESSAGES.transfer.complete(succeeded, failed, invalidCount);
  setStatus(refs.queueStatus, stopRequested ? UI_MESSAGES.transfer.queueStopped : UI_MESSAGES.transfer.queueComplete, stopRequested || failed ? "error" : "ok");
}

async function stopQueue() {
  stopRequested = true;
  refs.stopImportBtn.disabled = true;
  if (activeRequestId) {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.terminateImport, requestId: activeRequestId });
  }
}

async function exportVaultBackup() {
  refs.exportBackupBtn.disabled = true;
  setStatus(refs.backupStatus, UI_MESSAGES.options.backupPreparing);

  try {
    const mediaItems = await idbGetAllMedia();
    const mediaIds = mediaItems.map(({ id }) => id);
    const blobsById = await idbGetMediaBlobs(mediaIds);
    const backupJson = await createVaultBackup(mediaItems, blobsById);

    downloadBackupFile(backupJson);
    setStatus(refs.backupStatus, UI_MESSAGES.options.backupDownloaded(mediaItems.length), "ok");
  } catch {
    setStatus(refs.backupStatus, UI_MESSAGES.options.backupExportFailed, "error");
  } finally {
    refs.exportBackupBtn.disabled = false;
  }
}

async function restoreVaultBackup(backupFile) {
  if (!backupFile) return;

  refs.restoreBackupBtn.disabled = true;
  setStatus(refs.backupStatus, UI_MESSAGES.options.backupRestoring);

  try {
    const backupItems = parseVaultBackup(await backupFile.text());
    const existingItems = await idbGetAllMedia();
    const existingIds = new Set(existingItems.map(({ id }) => id));
    const newItems = backupItems.filter(({ id }) => !existingIds.has(id));
    const skippedCount = backupItems.length - newItems.length;

    await idbSaveMany(newItems);
    setStatus(
      refs.backupStatus,
      UI_MESSAGES.options.backupRestored(newItems.length, skippedCount),
      "ok",
    );
  } catch {
    setStatus(refs.backupStatus, UI_MESSAGES.options.backupRestoreFailed, "error");
  } finally {
    refs.restoreBackupBtn.disabled = false;
    refs.restoreBackupInput.value = "";
  }
}

function selectedImportMethod() {
  return document.querySelector('input[name="importMethod"]:checked')?.value === "files"
    ? "files"
    : "urls";
}

function animateSourcePanel(panel) {
  if (
    typeof panel?.animate !== "function" ||
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  panel.animate(
    [
      { opacity: 0, transform: "translateY(-6px) scale(0.995)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  );
}

function syncImportMethod({ animate = true } = {}) {
  const useFiles = selectedImportMethod() === "files";
  refs.urlSourcePanel.hidden = useFiles;
  refs.fileSourcePanel.hidden = !useFiles;
  if (animate) {
    animateSourcePanel(useFiles ? refs.fileSourcePanel : refs.urlSourcePanel);
  }
}

function setStatus(element, text, kind = "") {
  element.textContent = String(text || "");
  element.className = kind ? `status ${kind}` : "status";
}

function applyTheme(mode) {
  themeMode = applyDocumentTheme(mode);
  refs.themeToggleIcon.src = `../../assets/shared/${themeMode === "dark" ? "icon-theme-light.svg" : "icon-theme-moon.svg"}`;
}

function addResult(source, status, ok) {
  refs.emptyResults?.remove();
  const row = document.createElement("tr");
  const sourceCell = document.createElement("td");
  const statusCell = document.createElement("td");
  sourceCell.textContent = source;
  statusCell.textContent = status;
  statusCell.className = ok ? "result-ok" : "result-error";
  row.append(sourceCell, statusCell);
  refs.resultsBody.append(row);
}

async function loadTextFiles() {
  const files = [...(refs.textFilesInput.files || [])];
  textFileUrls = [];
  textFileInvalidCount = 0;
  for (const file of files) {
    const parsed = parseUrlList(await file.text());
    textFileUrls = mergeUrlLists(textFileUrls, parsed.urls);
    textFileInvalidCount += parsed.invalid.length;
  }
  refs.textFilesSummary.textContent = UI_MESSAGES.transfer.textFilesSummary(files.length, textFileUrls.length);
}

async function sendImport(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || UI_MESSAGES.transfer.failed);
  }
  return response.result;
}

async function importUrl(url, requestId) {
  return sendImport({ type: MESSAGE_TYPES.importUrl, url, requestId });
}

async function importFile(file, requestId) {
  const bytesBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(UI_MESSAGES.transfer.failed));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
  return sendImport({
    type: MESSAGE_TYPES.importFiles,
    requestId,
    files: [{
      name: file.name,
      mimeType: file.type,
      byteLength: file.size,
      bytesBase64,
    }],
  });
}

function downloadBackupFile(backupJson) {
  const url = URL.createObjectURL(new Blob([backupJson], { type: BACKUP_MIME_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `gif-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

refs.chooseTextFilesBtn.addEventListener("click", () => refs.textFilesInput.click());
refs.chooseMediaFilesBtn.addEventListener("click", () => refs.mediaFilesInput.click());
document.querySelectorAll('input[name="importMethod"]').forEach((input) => {
  input.addEventListener("change", syncImportMethod);
});
refs.textFilesInput.addEventListener("change", () => void loadTextFiles());
refs.mediaFilesInput.addEventListener("change", () => { refs.mediaFilesSummary.textContent = UI_MESSAGES.transfer.mediaFilesSummary(refs.mediaFilesInput.files?.length || 0); });
refs.startImportBtn.addEventListener("click", () => { if (!running) void startQueue(); });
refs.stopImportBtn.addEventListener("click", () => void stopQueue());
refs.exportBackupBtn.addEventListener("click", () => void exportVaultBackup());
refs.restoreBackupBtn.addEventListener("click", () => refs.restoreBackupInput.click());
refs.restoreBackupInput.addEventListener("change", () => void restoreVaultBackup(refs.restoreBackupInput.files?.[0]));
refs.themeToggleBtn.addEventListener("click", async () => { applyTheme(themeMode === "dark" ? "light" : "dark"); await setThemeMode(themeMode); });

addThemeLocaleStorageListener({
  onThemeChange: applyTheme,
  onLocaleChange: async (locale) => { await initializeI18n({ localeHint: locale, useStoredLocale: false }); applyStaticI18n(); },
});

await initializeI18n();
applyStaticI18n();
applyTheme(await getThemeMode());
syncImportMethod({ animate: false });
