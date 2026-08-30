import type { Range } from "../data";
import type { ExpandHints, Scale } from "../scale";

/**
 * Guarantees a minimum width so the domain never collapses to a single
 * point, and pads both ends. **This is linear addition** — a scale with
 * its own geometry supplies its own arithmetic via `Scale.expand`.
 */
export function expandRange({ min, max }: Range, ratio: number): [number, number] {
  const span = max - min;
  if (span === 0) return [min - 1, max + 1];

  const margin = span * ratio;
  return [min - margin, max + margin];
}

/**
 * **Padding belongs to the scale.** Use the scale's own `expand` if it has
 * one, otherwise fall back to linear addition — the caller doesn't need to
 * know which axis it is.
 *
 * A caller that invokes `expandRange` directly applies linear arithmetic
 * to a log axis too, which used to push the lower bound past zero once
 * `max/min > 11x` — `LogScale` then rejected the result.
 */
export function expandFor(
  scale: Scale,
  range: Range,
  ratio: number,
  hints?: ExpandHints,
): [number, number] {
  return scale.expand
    ? scale.expand([range.min, range.max], ratio, hints)
    : expandRange(range, ratio);
}

/** The range that contains both given ranges. */
export function unionRange(a: Range, b: Range): Range {
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/**
 * The range that contains all of them. **`null` entries are excluded from
 * the measurement** — "nothing to measure" is different from "measuring
 * zero". If everything is empty, there's nothing to fit, so the result is
 * `null`.
 */
export function unionOf(
  ranges: readonly (Range | null)[],
): Range | null {
  let result: Range | null = null;

  for (const range of ranges) {
    if (!range) continue;
    result = result ? unionRange(result, range) : range;
  }

  return result;
}
