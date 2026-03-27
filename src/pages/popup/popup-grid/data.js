import { UI_MESSAGES } from "../../../lib/messages.js";

function getEmptyMascotVariant({ query = "", currentTab = "all" } = {}) {
  if (String(query || "").trim()) {
    return "search-no-item";
  }
  return currentTab === "favorites" ? "fav-no-item" : "all-no-item";
}

function getEmptyMascotSrc(themeMode, variant) {
  const themePrefix = themeMode === "dark" ? "pesto" : "otha";
  return `../../assets/mascots/${themePrefix}-${variant}.webp`;
}

export function createGridDataController({
  state,
  getPopupMenuConfig,
  countEl,
  tabAllBtn,
  tabFavoritesBtn,
  prevPageBtn,
  nextPageBtn,
  pageIndicator,
}) {
  let latestVisibleItemCount = 0;
  let latestSavedItemCount = 0;
  let latestFavoritesCount = 0;

  function getFilteredItems(items) {
    const normalized = items.map((item) => ({
      ...item,
      favorite: Boolean(item.favorite),
      name: item.name || "",
    }));
    const byTab =
      state.currentTab === "favorites"
        ? normalized.filter((item) => item.favorite)
        : normalized;
    const query = state.searchTerm.trim().toLowerCase();
    const visibleItems = query
      ? byTab.filter((item) => {
          const haystack =
            `${item.name || ""} ${item.sourceUrl || ""} ${item.mediaUrl || ""}`.toLowerCase();
          return haystack.includes(query);
        })
      : byTab;

    return { normalized, visibleItems, query };
  }

  function getPagedItemsMeta(items) {
    const popupMenuConfig = getPopupMenuConfig();
    const totalPages = Math.max(
      1,
      Math.ceil(items.length / popupMenuConfig.pageSize),
    );
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    const startIndex = (state.currentPage - 1) * popupMenuConfig.pageSize;

    return {
      totalPages,
      pagedItemsMeta: items.slice(startIndex, startIndex + popupMenuConfig.pageSize),
    };
  }

  function updatePager(totalPages) {
    tabAllBtn.classList.toggle("active", state.currentTab === "all");
    tabFavoritesBtn.classList.toggle("active", state.currentTab === "favorites");
    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= totalPages;
    pageIndicator.textContent = UI_MESSAGES.grid.pageLabel(
      state.currentPage,
      totalPages,
    );
  }

  function createPaginationHint() {
    const hint = document.createElement("div");
    hint.className = "pagination-hint";
    hint.textContent = UI_MESSAGES.popup.paginationHint;
    return hint;
  }

  function refreshCountTextFromCache(selectedCount = 0) {
    const baseText =
      state.currentTab === "favorites"
        ? UI_MESSAGES.grid.favoritesCount(latestVisibleItemCount)
        : UI_MESSAGES.grid.savedAndFavoritesCount(
            latestSavedItemCount,
            latestFavoritesCount,
          );
    countEl.textContent = selectedCount > 0
      ? `${baseText} | ${UI_MESSAGES.grid.selectedCount(selectedCount)}`
      : baseText;
  }

  function setCountText(normalized, visibleItems, selectedCount = 0) {
    latestSavedItemCount = normalized.length;
    latestVisibleItemCount = visibleItems.length;
    latestFavoritesCount = normalized.filter((item) => item.favorite).length;
    refreshCountTextFromCache(selectedCount);
  }

  function createEmptyState(query) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const mascotVariant = getEmptyMascotVariant({
      query,
      currentTab: state.currentTab,
    });

    const mascot = document.createElement("img");
    mascot.className = "empty-mascot";
    mascot.src = getEmptyMascotSrc(state.themeMode, mascotVariant);
    mascot.dataset.variant = mascotVariant;
    mascot.alt = UI_MESSAGES.grid.emptyMascotAlt;

    const text = document.createElement("p");
    text.className = "empty-text";
    text.textContent = query
      ? UI_MESSAGES.grid.noSearchMatches
      : state.currentTab === "favorites"
        ? UI_MESSAGES.grid.noFavoritesYet
        : UI_MESSAGES.grid.emptyVaultPrompt;

    empty.append(mascot, text);
    return empty;
  }

  function updateEmptyStateMascotForTheme(grid, themeMode = state.themeMode) {
    const mascotEl = grid.querySelector(".empty-mascot");
    if (!mascotEl) {
      return;
    }
    const mascotVariant = mascotEl.dataset.variant || getEmptyMascotVariant({
      query: state.searchTerm,
      currentTab: state.currentTab,
    });
    mascotEl.src = getEmptyMascotSrc(themeMode, mascotVariant);
  }

  return {
    createEmptyState,
    createPaginationHint,
    getFilteredItems,
    getPagedItemsMeta,
    refreshCountTextFromCache,
    setCountText,
    updateEmptyStateMascotForTheme,
    updatePager,
  };
}
