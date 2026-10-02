/**
 * Visits each item of `list` as it stood when the walk began, skipping any
 * that has left it by its turn.
 *
 * For a loop whose body hands control to someone else's code — a series'
 * `valueExtent`, a source's `read`, a claimant's `areaOf` — that may remove
 * an item from the same list. Walking the live list by position would then
 * skip the item after the removed one; this walks a copy, so every item
 * present at the start gets its turn unless it left first. An item added
 * mid-walk waits for the next walk.
 */
export function forEachStill<T>(list: readonly T[], visit: (item: T) => void): void {
  // A copy on purpose — the live list may shrink under the walk.
  for (const item of list.slice()) {
    if (list.includes(item)) visit(item);
  }
}

/** `forEachStill`, collecting what each visit returns. */
export function mapStill<T, R>(list: readonly T[], visit: (item: T) => R): R[] {
  const out: R[] = [];
  forEachStill(list, (item) => {
    out.push(visit(item));
  });
  return out;
}
