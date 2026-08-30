import type { OHLC } from "@finchart/core";
import { requireSourceArray } from "./kernels";

/**
 * Heikin-Ashi — a pure transform that turns raw OHLC into smoothed candles.
 *
 * Not a new series type: the result is still `OHLC[]`, so `candleSeries()`
 * draws it as-is — use it as the `derive` material for `pane.addSeries`.
 *
 * ```ts
 * pane.addSeries({ series: candleSeries(), data: candles, derive: heikinAshi });
 * ```
 *
 * Convention:
 * - close = (O+H+L+C)/4
 * - open = for the first candle, (O+C)/2; after that, (previous HA open +
 *   previous HA close)/2 — it's stateful, so open doesn't connect back to
 *   the source
 * - high/low = the range spanning both the candle's own source high/low and
 *   its HA open/close
 *
 * x carries over from the source unchanged — one candle in, one candle out,
 * no new bricks counted. volume passes through unchanged — it isn't
 * something to smooth.
 */
export function heikinAshi(source: readonly OHLC[]): OHLC[] {
  requireSourceArray(source, "heikinAshi");
  const out: OHLC[] = [];
  let prevOpen = 0;
  let prevClose = 0;

  source.forEach((candle, index) => {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open =
      index === 0 ? (candle.open + candle.close) / 2 : (prevOpen + prevClose) / 2;
    const high = Math.max(candle.high, open, close);
    const low = Math.min(candle.low, open, close);

    out.push({ x: candle.x, open, high, low, close, volume: candle.volume });
    prevOpen = open;
    prevClose = close;
  });

  return out;
}
