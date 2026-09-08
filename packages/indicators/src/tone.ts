import type { HistogramPoint } from "@finchart/core";

/**
 * The one rule a toned indicator bar follows: against the bar before it,
 * `>=` is up and `<` is down — the candle's own `close >= open`, so a tie
 * is up and a bar has a tone whenever it has a predecessor. No tone on the
 * first value or right after a gap.
 *
 * Stateless and exactly one bar deep on purpose. A landing corrects
 * `headLookback` bars and keeps the rest; a tone that remembered further
 * back (say, inheriting the previous tone on a tie) would need an unbounded
 * lookback and no constant could close that door. One bar back is why the
 * toned factories declare `headLookback + 1` and nothing more.
 */
export function toneOf(
  previous: number | null | undefined,
  y: number | null,
): HistogramPoint["tone"] {
  if (y === null || previous === null || previous === undefined) return undefined;
  return y >= previous ? "up" : "down";
}
