import { describeValue, requireOptions, requireSourceArray } from "./kernels";
/**
 * Renko — a transform that discards time and keeps only price.
 *
 * A brick's x is ordinal (0, 1, 2…) — Renko's axis is "one step each time
 * price moves by brickSize," not uniform time. If you need time back,
 * recover it in the axis format via `closedAt`:
 *
 * ```ts
 * const bricks = renko(candles, { brickSize: 500 });
 * pane.addSeries({ series: candleSeries(), data: bricks });
 * plot.applyOptions({ axis: { x: { format: (x) =>
 *   timeLabel(bricks[Math.round(x)]?.closedAt ?? x) } } });
 * ```
 *
 * A pure transform like heikinAshi — no new series type, no core slot.
 * The result is OHLC-shaped, so candleSeries draws it as-is.
 */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";

export interface RenkoBrick extends OHLC {
  /** The brick's ordinal — this is the chart's x. */
  x: number;
  /** The x of the source candle that closed this brick. The key the axis format uses to recover time. */
  closedAt: number;
}

export interface RenkoOptions {
  /** The size of one brick — required. Knowledge of tick size and volatility belongs to the consumer. */
  brickSize: number;
}

/**
 * Traditional Renko, close-based. One brick per brickSize in the same
 * direction, **a reversal takes 2×brickSize** — a reversal brick opens one
 * gap away from the prior close (the classic rule). The first breakout
 * sets the direction.
 */
export function renko(
  source: readonly OHLC[],
  options: RenkoOptions,
): RenkoBrick[] {
  requireSourceArray(source, "renko");
  requireOptions(options, "renko");
  const { brickSize } = options;
  if (!(brickSize > 0) || !Number.isFinite(brickSize)) {
    throw new ContractError(
      `renko brickSize must be a positive number, got ${describeValue(brickSize)}`,
    );
  }

  const bricks: RenkoBrick[] = [];
  if (source.length === 0) return bricks;

  const emit = (open: number, close: number, closedAt: number): void => {
    bricks.push({
      x: bricks.length,
      open,
      close,
      high: Math.max(open, close),
      low: Math.min(open, close),
      closedAt,
    });
  };

  let level = source[0].close; // the previous brick's close — the baseline for the next brick
  let direction: 1 | -1 | 0 = 0;

  for (const candle of source) {
    const closedAt = candle.x; // the source candle's x, not an ordinal
    const close = candle.close;

    if (direction >= 0) {
      while (close - level >= brickSize) {
        emit(level, level + brickSize, closedAt);
        level += brickSize;
        direction = 1;
      }
    }
    if (direction <= 0) {
      while (level - close >= brickSize) {
        emit(level, level - brickSize, closedAt);
        level -= brickSize;
        direction = -1;
      }
    }

    // Reversal — two steps opposite from the previous brick's close: one gap + one brick.
    if (direction === 1 && level - close >= 2 * brickSize) {
      emit(level - brickSize, level - 2 * brickSize, closedAt);
      level -= 2 * brickSize;
      direction = -1;
      while (level - close >= brickSize) {
        emit(level, level - brickSize, closedAt);
        level -= brickSize;
      }
    } else if (direction === -1 && close - level >= 2 * brickSize) {
      emit(level + brickSize, level + 2 * brickSize, closedAt);
      level += 2 * brickSize;
      direction = 1;
      while (close - level >= brickSize) {
        emit(level, level + brickSize, closedAt);
        level += brickSize;
      }
    }
  }

  return bricks;
}
