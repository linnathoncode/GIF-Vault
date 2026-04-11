// Card helpers for popup grid items, actions, hover metadata, and copy behavior.
import { safeLog } from "../../../../lib/log.js";

const SHARED_ICON_BASE = "../../assets/shared";

function buildSharedIconPath(fileName) {
  return `${SHARED_ICON_BASE}/${fileName}`;
}

export function createButton({
  className,
  text,
  title,
  label,
  onClick,
  actionKey,
}) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  if (text) {
    button.textContent = text;
  }
  if (actionKey) {
    button.dataset.action = actionKey;
  }
  if (title) {
    button.title = title;
  }
  if (label) {
    button.setAttribute("aria-label", label);
  }
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

export function createButtonIcon(fileName, fallbackText = "") {
  const icon = document.createElement("img");
  icon.className = "btn-icon";
  icon.src = buildSharedIconPath(fileName);
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  if (fallbackText) {
    icon.dataset.fallback = fallbackText;
  }
  return icon;
}

export function setButtonIcon(button, fileName, fallbackText = "") {
  if (!(button instanceof HTMLElement)) {
    return;
  }
  button.replaceChildren(createButtonIcon(fileName, fallbackText));
}

export function createInvalidCard({
  item,
  createButton,
  UI_MESSAGES,
  deleteButtonLabelWithBatchHint,
  onDelete,
}) {
  const card = document.createElement("article");
  card.className = "item";
  card.dataset.itemId = String(item.id);
  const meta = document.createElement("div");
  meta.className = "meta";

  const urlText = document.createElement("div");
  urlText.className = "url";
  urlText.textContent =
    item.kind === "video"
      ? UI_MESSAGES.grid.invalidLegacyVideo
      : UI_MESSAGES.grid.invalidMediaEntry;

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    createButton({
      className: "btn",
      text: UI_MESSAGES.grid.remove,
      actionKey: "delete",
      title: deleteButtonLabelWithBatchHint(),
      onClick: onDelete,
    }),
  );

  meta.append(urlText, actions);
  card.append(meta);
  return card;
}

export function createPreviewMedia({
  item,
  previewUrl,
  previewController,
  hoverPreviewEl,
  UI_MESSAGES,
}) {
  const media = document.createElement("img");
  media.className = "thumb";
  media.src = previewUrl;
  media.alt = UI_MESSAGES.grid.savedGifAlt;
  media.loading = "lazy";
  media.addEventListener("error", () => {
    void safeLog("popup", "Image preview failed", {
      id: item.id,
      mimeType: item.mimeType || "",
    });
  });
  media.addEventListener("pointerenter", (event) => {
    previewController.scheduleHoverPreview(previewUrl, event);
  });
  media.addEventListener("pointermove", (event) => {
    previewController.updateHoverPointerPosition(event);
    if (hoverPreviewEl?.classList.contains("visible")) {
      previewController.positionHoverPreview(
        event?.clientX ?? 0,
        event?.clientY ?? 0,
      );
    }
  });
  media.addEventListener("pointerleave", previewController.hideHoverPreview);
  media.addEventListener("pointercancel", previewController.hideHoverPreview);
  return media;
}

export function createHoverInfoRow({
  item,
  hostFromUrl,
  formatBytes,
  UI_MESSAGES,
}) {
  const hoverInfoText = document.createElement("div");
  hoverInfoText.className = "meta-hover-row";
  const sourceHost =
    hostFromUrl(item.sourceUrl || item.mediaUrl || "") ||
    UI_MESSAGES.grid.sourceLocal;
  const sizeLabel = UI_MESSAGES.grid.sizeLabel(
    formatBytes(item.blob?.size || 0),
  );
  const hoverSourceText = document.createElement("span");
  hoverSourceText.className = "meta-hover-source";
  hoverSourceText.textContent = sourceHost;

  const hoverSizeText = document.createElement("span");
  hoverSizeText.className = "meta-hover-size";
  hoverSizeText.textContent = sizeLabel;

  hoverInfoText.append(hoverSourceText, hoverSizeText);
  return hoverInfoText;
}

export function attachCardSelectionHandlers({
  card,
  itemId,
  selectedItemIds,
  focusController,
  toggleCardSelection,
  removeCardFromSelection,
}) {
  // Keep nested action buttons from turning a card click into a selection change.
  card.addEventListener("mousedown", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }
    if (rawTarget.closest(".btn, .name-btn")) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    focusController.blurSelectionResetInputs();
    if (event.shiftKey || selectedItemIds.size > 0) {
      event.preventDefault();
    }
  });
  card.addEventListener("click", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }
    if (rawTarget.closest(".btn, .name-btn")) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    focusController.blurSelectionResetInputs();
    event.preventDefault();
    if (event.shiftKey || selectedItemIds.size > 0) {
      toggleCardSelection(itemId, card);
      return;
    }
    removeCardFromSelection(itemId, card);
  });
}

export function sanitizeCopyUrl(candidateUrl) {
  const normalized = String(candidateUrl || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return "";
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return "";
  }

  return parsedUrl.toString();
}

export async function copyItemUrl(item) {
  const canWriteText =
    navigator.clipboard && typeof navigator.clipboard.writeText === "function";
  if (canWriteText) {
    const copiedUrl = sanitizeCopyUrl(
      item.mediaUrl || item.sourceUrl || "",
    );
    if (!copiedUrl) {
      const hasNoSourceUrl = !String(item?.mediaUrl || item?.sourceUrl || "").trim();
      if (hasNoSourceUrl) {
        await safeLog("popup", "Copy failed (local path does not have URL)", {
          id: item.id,
        });
        return { ok: false, method: "none", reason: "no-source-url" };
      }
      await safeLog("popup", "Copy failed (local path does not have URL)", {
        id: item.id,
      });
      return { ok: false, method: "none", reason: "blocked" };
    }

    try {
      await navigator.clipboard.writeText(copiedUrl);
      await safeLog("popup", "Copy succeeded (url text)", { id: item.id });
      return {
        ok: true,
        method: "url",
        copiedUrl,
      };
    } catch (error) {
      await safeLog("popup", "Copy url failed", {
        id: item.id,
        error: error?.message || "unknown",
      });
    }
  }

  return { ok: false, method: "none" };
}
