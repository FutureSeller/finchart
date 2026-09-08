import { describeValue, requireOptions, requireSourceArray } from "./kernels";
/**
 * Renko — a transform that discards time and keeps only price.
 *
 * A brick's x is ordinal (0, 1, 2…) — Renko's axis is "one step each time
 * price moves by brickSize," not uniform time. Register it as a derivation
 * so ticks go in as candles and the viewport survives them, and win time
 * back in the axis format via `closedAt`:
 *
 * ```ts
 * const handle = pane.addSeries({
 *   series: candleSeries(),
 *   data: candles,
 *   derive: (c) => renko(c, { brickSize: 500 }),
 * });
 * handle.updateLast(candle); // a tick — the bricks are re-derived, the x viewport is not reset
 * plot.applyOptions({ axis: { x: { format: (x) => {
 *   // The handle holds the accepted bricks (typed as OHLC — narrow to reach closedAt). Inside their
 *   // span a tick takes the nearest brick's time; outside it, no time — no label.
 *   const bricks = handle.read();
 *   const brick = x >= 0 && x <= bricks.length - 1 ? bricks[Math.round(x)] : undefined;
 *   return brick && "closedAt" in brick && typeof brick.closedAt === "number" ? timeLabel(brick.closedAt) : "";
 * } } } });
 * ```
 *
 * A pure transform like heikinAshi — no new series type, no core slot.
 * The result is OHLC-shaped, so candleSeries draws it as-is. Every tick
 * re-derives the whole output — O(input + output): one candle can create or
 * destroy any number of bricks, which is not the tail shape `deriveLast`
 * promises, so there is no tail door; the guide's "Price-axis transforms"
 * section says what that costs and what does not fit beside an ordinal
 * axis.
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
  /**
   * The size of one brick — required, a positive number at most half the
   * largest double (a reversal is two bricks). Knowledge of tick size and
   * volatility belongs to the consumer.
   */
  brickSize: number;
}

/**
 * Traditional Renko, close-based. One brick per brickSize in the same
 * direction, **a reversal takes 2×brickSize** — a reversal brick opens one
 * gap away from the prior close (the classic rule). The first breakout
 * sets the direction.
 *
 * A close 2⁴⁷ bricks or more from zero cannot be laid — `ContractError` —
 * because past that a brick is under the doubles' own spacing at that
 * price and adding one would leave the level where it was (a brick of
 * 1,638 on a price of 10²⁰ is such a brick); the same door
 * `pointAndFigure` keeps for its boxes.
 */
export function renko(
  source: readonly OHLC[],
  options: RenkoOptions,
): RenkoBrick[] {
  requireSourceArray(source, "renko");
  requireOptions(options, "renko");
  const { brickSize } = options;
  // A reversal is two bricks: a brick over half the largest double has no reversal inside the doubles.
  if (typeof brickSize !== "number" || !(brickSize > 0) || !Number.isFinite(2 * brickSize)) {
    throw new ContractError(
      `renko brickSize must be a positive number at most half the largest double, got ${describeValue(brickSize)}`,
    );
  }

  const bricks: RenkoBrick[] = [];
  if (source.length === 0) return bricks;

  // A brick is laid only when the close is at least a brick past the level, so every brick's far end lies
  // between the level and a finite close — inside the doubles, as long as two bricks are.
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

  // The door a close has to pass to be laid in bricks: within 2⁴⁷ bricks of zero, where a brick is still far
  // above the doubles' spacing at that price (the spacing is under 2⁻⁵² of the price), so every step below
  // moves the level. Past it a step can be absorbed and the loops would never end.
  const laid = (close: number): number => {
    if (!(Math.abs(close) < brickSize * 2 ** 47)) {
      throw new ContractError(`renko brickSize ${describeValue(brickSize)} is too small to step the price ${describeValue(close)}`);
    }
    return close;
  };

  let level = laid(source[0].close); // the previous brick's close — the baseline for the next brick
  let direction: 1 | -1 | 0 = 0;

  for (const candle of source) {
    const closedAt = candle.x; // the source candle's x, not an ordinal
    const close = laid(candle.close);

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
