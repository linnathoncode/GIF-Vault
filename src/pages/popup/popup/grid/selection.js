export function selectionIdsChanged(previousIds, nextIds) {
  const before = [...previousIds].map((id) => String(id)).sort();
  const after = [...nextIds].map((id) => String(id)).sort();
  if (before.length !== after.length) {
    return true;
  }
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) {
      return true;
    }
  }
  return false;
}

export function shouldCancelArmedDeleteOnSelectionChange(
  armedDeleteActionKey,
  previousSelectionIds,
  nextSelectionIds,
) {
  return (
    Boolean(armedDeleteActionKey) &&
    selectionIdsChanged(previousSelectionIds, nextSelectionIds)
  );
}

export function armedDeleteGlyph(count) {
  return count > 1 ? "!" : "\u2713";
}
