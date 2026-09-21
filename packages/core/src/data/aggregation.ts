import { DataError } from "../primitives";
import { isGap } from "./accessors";
import { passthrough } from "./decimation";
import type { DecimationStrategy, IndexRange, OHLC } from "./types";

/**
 * Merges candles instead of decimating them. Other strategies pick some of
 * the original points, but picking just one candle would drop the rest's
 * high and low, so this one builds a new candle instead. Like folding five
 * 1-minute candles into one 5-minute candle:
 *
 *     open  = first candle's open    high = the range's highest
 *     close = last candle's close    low  = the range's lowest
 *
 * Buckets split by index — splitting by x would give each bucket a
 * different candle count, so bars of the same width would each mean a
 * different span of time.
 */
export class OhlcAggregation implements DecimationStrategy<OHLC> {
  decimate(data: OHLC[], range: IndexRange, threshold: number): OHLC[] {
    const count = range.end - range.start;
    // If there's nothing to reduce, use the same gate as the sibling strategies — one copy of it instead of two.
    if (count <= threshold) return passthrough(data, range.start, range.end);

    const buckets = Math.max(1, Math.floor(threshold));
    /**
     * Boundaries are set as fractions. Cutting the candle count to whole
     * numbers (`ceil(n/threshold)`) can leave the budget half-empty — fitting
     * 3125 candles into 1000 by grouping 4 per bucket produces only 782.
     * Splitting by fraction mixes 3-candle and 4-candle buckets to land on
     * exactly 1000.
     */
    const step = count / buckets;
    const merged: OHLC[] = [];

    for (let i = 0; i < buckets; i++) {
      const start = range.start + Math.floor(i * step);
      const end =
        i === buckets - 1 ? range.end : range.start + Math.floor((i + 1) * step);
      merged.push(merge(data, start, end));
    }

    return merged;
  }
}

/** Folds one [start, end) range into a single candle. */
function merge(data: OHLC[], start: number, end: number): OHLC {
  const first = data[start];
  const last = data[end - 1];

  let high = first.high;
  let low = first.low;
  // A gap (null or absent) is not a number to add — the first bar's gap
  // used to seed the sum with `null`, which `+` turned into 0.
  let volume: number | undefined = isGap(first.volume) ? undefined : first.volume;

  for (let i = start + 1; i < end; i++) {
    const candle = data[i];

    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    // Volume can be a gap. Sum only what's there, and leave it absent if none are.
    if (!isGap(candle.volume)) {
      volume = (volume ?? 0) + candle.volume;
      if (!Number.isFinite(volume)) {
        throw new DataError("OHLC aggregation volume must remain finite");
      }
    }
  }

  const candle: OHLC = {
    // The merged candle sits at the start of the range — where the first candle was.
    x: first.x,
    open: first.open,
    high,
    low,
    close: last.close,
  };

  if (first.label !== undefined) candle.label = first.label;
  if (volume !== undefined) candle.volume = volume;

  return candle;
}
