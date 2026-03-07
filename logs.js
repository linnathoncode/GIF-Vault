import { idbGetLogs, idbClearLogs } from "./db.js";

const logsEl = document.getElementById("logs");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status";
}

async function renderLogs() {
  const logs = await idbGetLogs(500);
  if (!logs.length) {
    logsEl.textContent = "No logs yet.";
    setStatus("0 logs", true);
    return;
  }

  const lines = logs.map((log) => {
    const when = new Date(log.createdAt || Date.now()).toLocaleTimeString();
    const details = log.details ? ` ${JSON.stringify(log.details)}` : "";
    return `[${when}] ${log.stage}: ${log.message}${details}`;
  });

  logsEl.textContent = lines.join("\n");
  setStatus(`${logs.length} logs`, true);
}

refreshBtn.addEventListener("click", () => {
  void renderLogs();
});

clearBtn.addEventListener("click", async () => {
  await idbClearLogs();
  setStatus("Logs cleared.", true);
  await renderLogs();
});

renderLogs();