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

/** A number's shortest decimal spelling, without introducing a tolerance at a price boundary. */
function decimal(value: number): { units: bigint; exponent: number } {
  const [mantissa, power = "0"] = String(value).split("e");
  const dot = mantissa.indexOf(".");
  const places = dot < 0 ? 0 : mantissa.length - dot - 1;
  return { units: BigInt(mantissa.replace(".", "")), exponent: Number(power) - places };
}

/** Integer brick positions on the initial close's decimal grid. */
function brickGrid(origin: number, size: number) {
  // Subnormal shortest spellings can differ appreciably from their actual
  // value (MIN_VALUE prints as 5e-324). Each is instead an exact integral
  // multiple of MIN_VALUE; the price guard keeps this division finite.
  const binary = size < 2 ** -1022;
  const base = binary ? { units: BigInt(origin / Number.MIN_VALUE), exponent: 0 } : decimal(origin);
  const step = binary ? { units: BigInt(size / Number.MIN_VALUE), exponent: 0 } : decimal(size);
  const exponent = Math.min(base.exponent, step.exponent);
  const scale = (units: bigint, from: number, to: number) => units * 10n ** BigInt(from - to);
  const baseUnits = scale(base.units, base.exponent, exponent);
  const stepUnits = scale(step.units, step.exponent, exponent);
  const baseNumber = Number(baseUnits);
  const stepNumber = Number(stepUnits);
  // Ordinary decimal price grids stay in exact integer arithmetic. Powers
  // through 10^22 are exact doubles; larger coefficients use decimal parsing.
  const fastLimit = Math.abs(exponent) <= 22 && Number.isSafeInteger(baseNumber) && Number.isSafeInteger(stepNumber)
    ? Math.floor((Number.MAX_SAFE_INTEGER - Math.abs(baseNumber)) / stepNumber)
    : -1;
  const factor = binary ? Number.MIN_VALUE : 10 ** Math.abs(exponent);

  const price = (index: number): number => {
    if (Math.abs(index) <= fastLimit) {
      const units = baseNumber + index * stepNumber;
      return exponent < 0 ? units / factor : units * factor;
    }
    const units = baseUnits + BigInt(index) * stepUnits;
    return binary ? Number(units) * Number.MIN_VALUE : Number(`${units}e${exponent}`);
  };

  return {
    bounds(close: number) {
      const distance = close - origin;
      // Division only locates the candidate step. Comparing its rounded
      // grid price decides the boundary, so no epsilon swallows a real move.
      // Splitting the quotient also handles a difference that overflows.
      let floor = Math.floor(Number.isFinite(distance) ? distance / size : close / size - origin / size);
      while (price(floor) > close) floor -= 1;
      while (price(floor + 1) <= close) floor += 1;
      return { floor, ceil: price(floor) === close ? floor : floor + 1 };
    },
    price,
  };
}

/**
 * Traditional Renko, close-based. One brick per brickSize in the same
 * direction, **a reversal takes 2×brickSize** — a reversal brick opens one
 * gap away from the prior close (the classic rule). The first breakout
 * sets the direction. Boundaries use the shortest decimal spellings of the
 * initial close, each close, and brickSize: 0.3 reaches three 0.1 bricks,
 * but the immediately preceding double does not. Prices are rounded from
 * that integer grid once, rather than accumulated by repeated addition;
 * reaching the rounded grid price also reaches the boundary. Subnormal
 * brick sizes use exact binary units instead: their shortest decimal
 * spelling can have too few digits to preserve a long run's brick count.
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

  // The door a close has to pass to be laid in bricks: within 2⁴⁷ bricks of zero, where a brick is still far
  // above the doubles' spacing at that price (the spacing is under 2⁻⁵² of the price), so every step below
  // moves the level. Past it a step can be absorbed and the loops would never end.
  const laid = (close: number): number => {
    if (!(Math.abs(close) < brickSize * 2 ** 47)) {
      throw new ContractError(`renko brickSize ${describeValue(brickSize)} is too small to step the price ${describeValue(close)}`);
    }
    return close;
  };

  const grid = brickGrid(laid(source[0].close), brickSize);
  let level = 0;
  let direction: 1 | -1 | 0 = 0;
  const emit = (open: number, close: number, closedAt: number): void => {
    const from = grid.price(open);
    const to = grid.price(close);
    bricks.push({ x: bricks.length, open: from, close: to, high: Math.max(from, to), low: Math.min(from, to), closedAt });
  };

  for (const candle of source) {
    const closedAt = candle.x;
    // One grid-boundary calculation per candle, never one per brick.
    const { floor: upTo, ceil: downTo } = grid.bounds(laid(candle.close));

    if (direction >= 0) {
      while (upTo > level) {
        emit(level, level + 1, closedAt);
        level += 1;
        direction = 1;
      }
    }
    if (direction <= 0) {
      while (downTo < level) {
        emit(level, level - 1, closedAt);
        level -= 1;
        direction = -1;
      }
    }

    // Reversal — two steps opposite from the previous brick's close: one gap + one brick.
    if (direction === 1 && level - downTo >= 2) {
      emit(level - 1, level - 2, closedAt);
      level -= 2;
      direction = -1;
      while (downTo < level) {
        emit(level, level - 1, closedAt);
        level -= 1;
      }
    } else if (direction === -1 && upTo - level >= 2) {
      emit(level + 1, level + 2, closedAt);
      level += 2;
      direction = 1;
      while (upTo > level) {
        emit(level, level + 1, closedAt);
        level += 1;
      }
    }
  }

  return bricks;
}
