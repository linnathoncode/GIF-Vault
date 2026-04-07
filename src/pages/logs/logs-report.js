// Logs report helpers: package the current log snapshot into an attachment and
// launch the user's bug-report draft without coupling the page coordinator to email details.
const BUG_REPORT_SUPPORT_EMAIL = "gifvault.support@gmail.com";

function buildReportLogsAttachmentText({ logs, extensionVersion, formatLogExportLine }) {
  const safeVersion = String(extensionVersion || "unknown");
  const lines = Array.isArray(logs) ? logs.map((log) => formatLogExportLine(log)) : [];
  const headerLines = [
    "GIF Vault Bug Report Logs",
    `Generated At (UTC): ${new Date().toISOString()}`,
    `Extension Version: ${safeVersion}`,
    `Log Count: ${lines.length}`,
    "----------------------------------------",
  ];
  return `${headerLines.join("\n")}\n${lines.join("\n")}\n`;
}

function buildLogsAttachmentName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `gif-vault-logs-${stamp}.txt`;
}

function triggerAttachmentDownload(name, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function openBugReportDraft({
  description,
  attachmentName,
  logCount,
  UI_MESSAGES,
  supportEmail = BUG_REPORT_SUPPORT_EMAIL,
}) {
  // Build a prefilled Gmail compose link so the page can hand off reporting in one step.
  const safeDescription = description || UI_MESSAGES.logs.reportDescriptionDefault;
  const subject = UI_MESSAGES.logs.reportEmailSubject;
  const body = UI_MESSAGES.logs.reportEmailBody(
    safeDescription,
    attachmentName,
    logCount,
  );
  const composeUrl = new URL("https://mail.google.com/mail/");
  composeUrl.searchParams.set("view", "cm");
  composeUrl.searchParams.set("fs", "1");
  composeUrl.searchParams.set("tf", "1");
  composeUrl.searchParams.set("to", supportEmail);
  composeUrl.searchParams.set("su", subject);
  composeUrl.searchParams.set("body", body);
  globalThis.open(composeUrl.toString(), "_blank", "noopener,noreferrer");
}

export {
  buildLogsAttachmentName,
  buildReportLogsAttachmentText,
  openBugReportDraft,
  triggerAttachmentDownload,
};
