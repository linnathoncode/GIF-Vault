import { describe, expect, it } from "vitest";
import { createGridDataController } from "../../src/pages/popup/popup/grid/data.js";

function createStubElement() {
  return {
    classList: { toggle() {} },
    disabled: false,
    textContent: "",
  };
}

describe("popup grid null querySelector repro", () => {
  it("does not throw when grid is null", () => {
    const state = {
      currentTab: "all",
      currentPage: 1,
      searchTerm: "",
      themeMode: "light",
    };

    const controller = createGridDataController({
      state,
      getPopupMenuConfig: () => ({ pageSize: 12 }),
      countEl: createStubElement(),
      tabAllBtn: createStubElement(),
      tabFavoritesBtn: createStubElement(),
      prevPageBtn: createStubElement(),
      nextPageBtn: createStubElement(),
      pageIndicator: createStubElement(),
    });

    expect(() => controller.updateEmptyStateMascotForTheme(null, "dark")).not.toThrow();
  });
});
