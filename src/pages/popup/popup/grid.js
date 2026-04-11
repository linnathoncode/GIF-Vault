// Re-export the popup grid controller surface for the popup page coordinator.
export { createPopupGridController } from "./grid/controller.js";
export {
  armedDeleteGlyph,
  selectionIdsChanged,
  shouldCancelArmedDeleteOnSelectionChange,
} from "./grid/interaction.js";
export {
  sanitizeCopyUrl,
} from "./grid/card.js";
