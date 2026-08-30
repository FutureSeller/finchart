/**
 * A pair of binary searches over the sort contract. Slicing (a
 * `DataManager` window) and finding the nearest point (`Entry.nearest`) use
 * the same search — the kind of duplication where scattering it invites one
 * comparison operator to drift, so it lives in one place.
 */

/** The first position where getX is at or above value. If none, the length. */
export function lowerBoundBy<T>(
  source: readonly T[],
  value: number,
  getX: (point: T) => number,
): number {
  let low = 0;
  let high = source.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (getX(source[mid]) < value) low = mid + 1;
    else high = mid;
  }

  return low;
}

/** The first position where getX exceeds value. Since this is the cut end, value itself is included. */
export function upperBoundBy<T>(
  source: readonly T[],
  value: number,
  getX: (point: T) => number,
): number {
  let low = 0;
  let high = source.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (getX(source[mid]) <= value) low = mid + 1;
    else high = mid;
  }

  return low;
}
