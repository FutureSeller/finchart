import { lowerBoundBy } from "./search";

/**
 * **Merges by x: every x the incoming names becomes the incoming's, every
 * x it does not name keeps what it had.** Where both hold an x, the whole
 * held run at that x is replaced by the whole incoming run at it — a run
 * being one point where x is unique and several where it is not — so the
 * result's x keys are the union of the two, and its record count can go
 * down where duplicates are allowed. An incoming x the held has not got is
 * put where it belongs.
 *
 * Both arrays must already be validated: finite x, non-decreasing. This
 * does no checking — the callers own their doors — and it preserves the
 * held points' object identities outside the runs it replaces, which is
 * what lets a consumer downstream see a tail change as a tail change.
 *
 * `start` is where the held array first differs: everything before it is
 * the same objects in the same order, so a caller comparing x values need
 * only look from there.
 */
export function mergeByX<T>(
  held: readonly T[],
  incoming: readonly T[],
  getX: (point: T) => number,
): { points: T[]; start: number } {
  if (incoming.length === 0) return { points: held.slice(), start: held.length };

  const start = lowerBoundBy(held, getX(incoming[0]), getX);
  const points = held.slice(0, start);
  let i = start;
  let j = 0;
  while (i < held.length && j < incoming.length) {
    const hx = getX(held[i]);
    const ix = getX(incoming[j]);
    if (hx < ix) {
      points.push(held[i]);
      i += 1;
    } else if (hx > ix) {
      points.push(incoming[j]);
      j += 1;
    } else {
      // The same x on both sides: the held run at it is skipped whole and
      // the incoming run at it is taken whole. Each side advances at least
      // once whatever the values are — a `NaN` is neither below nor above
      // anything, and a loop that waited for it to equal itself would
      // never end. The callers refuse one before it gets here; this only
      // promises to finish.
      do i += 1;
      while (i < held.length && getX(held[i]) === hx);
      do {
        points.push(incoming[j]);
        j += 1;
      } while (j < incoming.length && getX(incoming[j]) === hx);
    }
  }
  for (; i < held.length; i++) points.push(held[i]);
  for (; j < incoming.length; j++) points.push(incoming[j]);
  return { points, start };
}
