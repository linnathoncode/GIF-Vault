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
