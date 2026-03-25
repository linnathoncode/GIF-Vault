import { describe, expect, it } from "vitest";
import {
  armedDeleteGlyph,
  selectionIdsChanged,
  shouldCancelArmedDeleteOnSelectionChange,
} from "../../src/pages/popup/popup-grid.js";

describe("popup-grid multi-select delete helpers", () => {
  it("uses the danger ! glyph for multi-select delete arming", () => {
    expect(armedDeleteGlyph(2)).toBe("!");
    expect(armedDeleteGlyph(3)).toBe("!");
    expect(armedDeleteGlyph(1)).toBe("\u2713");
  });

  it("detects selection changes regardless of order", () => {
    expect(selectionIdsChanged(["1", "2"], ["2", "1"])).toBe(false);
    expect(selectionIdsChanged(["1", "2"], ["1", "2", "3"])).toBe(true);
    expect(selectionIdsChanged(["1", "2"], ["1"])).toBe(true);
  });

  it("cancels armed delete only when selection actually changes", () => {
    expect(
      shouldCancelArmedDeleteOnSelectionChange("batch:1,2", ["1", "2"], ["1", "2", "3"]),
    ).toBe(true);
    expect(
      shouldCancelArmedDeleteOnSelectionChange("batch:1,2", ["1", "2"], ["2", "1"]),
    ).toBe(false);
    expect(
      shouldCancelArmedDeleteOnSelectionChange("", ["1", "2"], ["1", "2", "3"]),
    ).toBe(false);
  });
});
