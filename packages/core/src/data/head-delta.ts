/**
 * Determines whether the change between two arrays is a landing — growth
 * at the front, possibly with a corrected zone where the old head was
 * recomputed.
 *
 * The counterpart of `tailDelta`, reading the same channel: a node only
 * sees its inputs through `Source.read()`, so point-object identity is
 * what carries the shape of a change. `calcFirst`'s output rule (reuse
 * the previous array's tail beyond the corrected zone) is what makes the
 * shift and the zone's width recoverable from identities alone — the
 * first reused object marks where the correction ends.
 *
 * The discipline is tailDelta's: the entire reused range is checked, not
 * a sample. A swap hiding mid-array must come back null — a wrong
 * classification would draw a silently wrong indicator, while null merely
 * costs the full path.
 */
export type HeadChange = {
  kind: "prepend";
  /** How many points landed at the front. */
  count: number;
  /**
   * How many of the old head positions were recomputed — their objects
   * are fresh even though their x stayed put (warmup filling in, a
   * seeded recursion settling).
   */
  corrected: number;
};

export function headDelta<T>(
  previous: readonly T[],
  next: readonly T[],
): HeadChange | null {
  if (!Array.isArray(previous) || !Array.isArray(next)) return null;
  const p = previous.length;
  const n = next.length;
  // Nothing to land on, or it shrank or stayed put — not a landing.
  if (p === 0 || n <= p) return null;
  // The cheapest disqualifier first: a landing never touches the tail.
  if (next[n - 1] !== previous[p - 1]) return null;

  const count = n - p;
  // The corrected zone ends at the first reused object.
  let corrected = 0;
  while (corrected < p && next[count + corrected] !== previous[corrected]) {
    corrected++;
  }
  if (corrected === p) return null; // nothing of the old array survives

  // One rule: everything past the corrected zone must be the old array,
  // object for object — any mismatch anywhere means null.
  for (let i = corrected; i < p; i++) {
    if (next[count + i] !== previous[i]) return null;
  }

  return { kind: "prepend", count, corrected };
}
