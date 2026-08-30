/**
 * Determines whether the change between two arrays is tail-only.
 *
 * A `computation` node only receives its inputs through `Source.read()`, so
 * it has no way to be told the shape of a change — instead, point object
 * identity carries that information. An unchanged point object gets reused
 * (the `Source` contract), so if the identities all match at the front and
 * only the tail differs, that change is a tail change.
 *
 * Checks the entire shared range — not a sample. Checking only a few points
 * would miss a change in the middle and silently produce a wrong indicator.
 * A full check is O(n) pointer comparisons, which is always cheaper than
 * the recomputation (several O(n) passes) it's meant to save.
 */
export type TailChange =
  /** The front is unchanged and `count` items were appended at the end. */
  | { kind: "append"; count: number }
  /**
   * The front is unchanged and the last `count` items were swapped out.
   * This detector always produces 1 — the field exists to keep the shape
   * of the gate contract (`deriveLast`, `calcLast`) symmetric with append.
   */
  | { kind: "replace"; count: number }
  /** Array identity differs but every element's identity matches — nothing to compute. */
  | { kind: "none" };

export function tailDelta<T>(
  previous: readonly T[],
  next: readonly T[],
): TailChange | null {
  // If the shapes don't match, this "can't be classified," and when it can't be classified, null is the answer (the full path).
  if (!Array.isArray(previous) || !Array.isArray(next)) return null;
  const p = previous.length;
  const n = next.length;
  // Was empty, became empty, or shrank — none of these are a tail change. Take the full path.
  if (p === 0 || n === 0 || n < p) return null;

  // One rule: the shared range must all match for this to be a tail change —
  // any mismatch anywhere means null. `replace` is only ever used with
  // count 1, so this doesn't generalize beyond that.
  const shared = n === p ? p - 1 : p;
  for (let i = 0; i < shared; i++) {
    if (previous[i] !== next[i]) return null;
  }

  if (n === p) {
    return previous[p - 1] === next[p - 1]
      ? { kind: "none" }
      : { kind: "replace", count: 1 };
  }
  return { kind: "append", count: n - p };
}
