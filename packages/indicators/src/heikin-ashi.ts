import type { DataView, OHLC } from "@finchart/core";
import { requireSourceArray } from "./kernels";

/** The HA bar before this one — all a Heikin-Ashi bar needs from history. */
interface Seed {
  open: number;
  close: number;
}

/**
 * One Heikin-Ashi bar. The close is the raw bar's average; the open is the
 * midpoint of the *previous HA* bar, or of the raw open/close when there is
 * no previous bar — that seed is why the derivation has no finite head
 * door: a page prepended in front changes bar 0's seed, and every open
 * after it follows.
 */
function fold(candle: OHLC, previous: Seed | null): OHLC {
  const sum = candle.open + candle.high + candle.low + candle.close;
  // Keep ordinary/subnormal rounding unchanged; scale only an overflowing sum.
  const close = Number.isFinite(sum)
    ? sum / 4
    : candle.open / 4 + candle.high / 4 + candle.low / 4 + candle.close / 4;
  const open =
    previous === null ? midpoint(candle.open, candle.close) : midpoint(previous.open, previous.close);
  const high = Math.max(candle.high, open, close);
  const low = Math.min(candle.low, open, close);
  return { x: candle.x, open, high, low, close, volume: candle.volume };
}

function midpoint(a: number, b: number): number {
  const sum = a + b;
  return Number.isFinite(sum) ? sum / 2 : a / 2 + b / 2;
}

/**
 * Heikin-Ashi: candles smoothed into their own averages. A derivation
 * `OHLC[] → OHLC[]` — feed the result to a candle series. Its tail is
 * `heikinAshiLast`.
 */
export function heikinAshi(source: readonly OHLC[]): OHLC[] {
  requireSourceArray(source, "heikinAshi");
  const out: OHLC[] = [];
  let previous: Seed | null = null;
  for (const candle of source) {
    const bar = fold(candle, previous);
    out.push(bar);
    previous = bar;
  }
  return out;
}

/**
 * The tail of `heikinAshi` — `deriveLast` for a candle series fed by it:
 *
 * ```ts
 * pane.addSeries({ series: candleSeries(), data: bars, derive: heikinAshi, deriveLast: heikinAshiLast });
 * ```
 *
 * Returns exactly the changed tail — `count` bars for an append, folded
 * from the last HA bar held, one for a replace, folded from the HA bar
 * before it (or from the raw bar's own seed when that is bar 0). The
 * prefix stays where it is; the door keeps it.
 */
export function heikinAshiLast(
  previous: DataView<OHLC>,
  source: DataView<OHLC>,
  change: { kind: "append" | "replace"; count: number },
): OHLC[] {
  const count = change.kind === "replace" ? 1 : change.count;
  const kept = previous.length - (change.kind === "replace" ? 1 : 0);
  let seed: Seed | null = kept > 0 ? previous[kept - 1] : null;
  const out: OHLC[] = [];
  for (let i = source.length - count; i < source.length; i++) {
    const bar = fold(source[i], seed);
    out.push(bar);
    seed = bar;
  }
  return out;
}
