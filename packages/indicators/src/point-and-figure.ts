import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describeValue, requireOptions, requireSourceArray } from "./kernels";

/**
 * Point & Figure — a price-axis transform in the Renko lineage: time is
 * thrown away and price is quantised onto an absolute grid of boxes,
 * `boxSize` apart and aligned to its multiples. A column of X's rises
 * (`tone: "up"`), a column of O's falls (`tone: "down"`); a column's x is an
 * ordinal (0, 1, 2…), the last column is live and grows with the close
 * until a reversal starts the next one. A column is OHLC-shaped — its
 * `low`/`high` are the prices of its lowest and highest box, `open`/`close`
 * the end it started from and the end it reached — so `candleSeries()` draws
 * it as a bar (a series drawing the X and O glyphs is the natural next
 * step); `boxes` is how many it holds. Register it as a derivation — see the
 * guide's "Price-axis transforms".
 */
export interface PointAndFigureColumn extends OHLC {
  /** The column's ordinal — this is the chart's x. */
  x: number;
  /** The x of the source candle whose close last extended the column. The key the axis format uses to recover time. */
  closedAt: number;
  /** `up` is a column of X's, `down` a column of O's — the slot a two-colour series reads. */
  tone: "up" | "down";
  /** How many boxes the column holds. */
  boxes: number;
}

export interface PointAndFigureOptions {
  /** The box — an absolute price distance, a positive normal double (2⁻¹⁰²² or more), required. The grid is its multiples. */
  boxSize: number;
  /**
   * How many boxes the close has to give back from the column's end to start
   * the opposite column. Default 3, the classic three-box reversal. `1` is
   * the generic one-box rule (a column can hold a single box) — not Wyckoff's
   * one-box convention, which needs two entries before a column can turn.
   */
  reversal?: number;
}

/** The defaults: the three-box reversal. `boxSize` has none — knowledge of tick size and volatility belongs to the consumer. */
export const POINT_AND_FIGURE_DEFAULTS = { reversal: 3 } as const;

/** The box's door, shared with the series that draws the columns: a positive normal double. */
export function requireBoxSize(boxSize: unknown, name: string): number {
  if (typeof boxSize !== "number" || !(boxSize >= 2 ** -1022) || !Number.isFinite(boxSize)) {
    throw new ContractError(`${name} boxSize must be a positive normal number (2⁻¹⁰²² or more), got ${describeValue(boxSize)}`);
  }
  return boxSize;
}

/**
 * Close-based, one candle moves one column once. Boxes are integer levels
 * on the grid — a rising close reaches level `floor(close / boxSize)`, a
 * falling one `ceil(close / boxSize)` (a box is filled only when the close
 * reaches it), where the quotient the division gives, when within a
 * relative 8 × 2⁻⁵² of an integer, is that integer. With a normal box and a
 * normal close a decimal tie always lands inside that window (its exact
 * quotient is the integer and the division strays by a couple of 2⁻⁵² at
 * most — which is why a subnormal box is refused: its digits are already
 * gone), so a close written as the decimal a box sits on fills it
 * (`0.3 / 0.1` is `2.9999999999999996` in doubles); a close a real fraction
 * short does not, and one a few 2⁻⁵² short is not a tie — it lands on
 * whichever side of the window the division puts it. A price is a level
 * times `boxSize`, multiplied once, never accumulated, so a fractional box
 * keeps the grid straight. A level 2⁴⁷ boxes or more away from zero cannot
 * be kept — judged after the snap — because past it the snap window, a
 * quarter of a level wide there, would start to reach neighbouring levels
 * (the division itself stays sharp much further; the window is the limit);
 * and a box so large that a level's price
 * leaves the double range cannot be priced — `ContractError` either way,
 * for the reference candle as for any other. The first candle's close is the
 * reference; the first close that reaches a grid level strictly beyond it —
 * the next level up, or the next level down — starts the first column at
 * that level. In a rising column a close reaching
 * a higher level fills the boxes up to it; a close giving back `reversal`
 * boxes or more from the column's top starts the falling column one box
 * below that top, down to the level reached. The falling column mirrors it.
 * Anything else moves nothing. The grid is absolute — every column's boxes
 * sit on the same multiples of `boxSize` whatever history precedes them —
 * but the columns are path-dependent (each starts one box inside the
 * previous one's extreme), so a history page prepended later can redraw
 * columns well past the seam; the transform re-derives the whole tape and
 * builds every column afresh.
 */
export function pointAndFigure(source: readonly OHLC[], options: PointAndFigureOptions): PointAndFigureColumn[] {
  requireSourceArray(source, "pointAndFigure");
  requireOptions(options, "pointAndFigure");
  const boxSize = requireBoxSize(options.boxSize, "pointAndFigure");
  // Only an omitted option takes the default — a JavaScript caller's null is refused like any other non-integer.
  const reversal = options.reversal === undefined ? POINT_AND_FIGURE_DEFAULTS.reversal : options.reversal;
  if (!Number.isInteger(reversal) || reversal < 1) {
    throw new ContractError(`pointAndFigure reversal must be a positive integer, got ${describeValue(reversal)}`);
  }

  const columns: PointAndFigureColumn[] = [];
  if (source.length === 0) return columns;

  // A quotient within a relative 8 × 2⁻⁵² of an integer is that integer — the division's own rounding with a
  // little margin, which is what parts a decimal close from the decimal box level it sits on; anything wider
  // would swallow real fractions.
  const snap = (q: number): number | null => {
    const nearest = Math.round(q);
    return Math.abs(q - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(q)) ? nearest : null;
  };
  // The level is judged after the snap — a quotient just under the bound snaps onto it. 2⁴⁷ keeps the snap
  // window (a relative 8 × 2⁻⁵²) under a quarter of a level, so it can only ever hold one integer.
  const kept = (level: number, close: number): number => {
    if (!(Math.abs(level) < 2 ** 47)) {
      throw new ContractError(`pointAndFigure boxSize ${describeValue(boxSize)} is too small to quantise the price ${describeValue(close)}`);
    }
    return level;
  };
  const up = (close: number): number => {
    const q = close / boxSize;
    return kept(snap(q) ?? Math.floor(q), close);
  };
  const down = (close: number): number => {
    const q = close / boxSize;
    return kept(snap(q) ?? Math.ceil(q), close);
  };

  let direction: 1 | -1 | 0 = 0;
  let top = 0; // the live column's highest level
  let bottom = 0; // its lowest level
  let column: PointAndFigureColumn | null = null;

  const price = (level: number): number => {
    const value = level * boxSize;
    if (!Number.isFinite(value)) {
      throw new ContractError(`pointAndFigure boxSize ${describeValue(boxSize)} is too large to price level ${level}`);
    }
    return value;
  };
  const refresh = (closedAt: number): void => {
    if (column === null) return;
    column.low = price(bottom);
    column.high = price(top);
    column.open = direction === 1 ? column.low : column.high;
    column.close = direction === 1 ? column.high : column.low;
    column.boxes = top - bottom + 1;
    column.closedAt = closedAt;
  };
  const start = (next: 1 | -1, low: number, high: number, closedAt: number): void => {
    direction = next;
    bottom = low;
    top = high;
    column = { x: columns.length, open: 0, high: 0, low: 0, close: 0, closedAt, tone: next === 1 ? "up" : "down", boxes: 0 };
    columns.push(column);
    refresh(closedAt);
  };

  const first = source[0].close;
  // The reference must be quantisable and priceable too — a lone candle is refused the same way.
  price(up(first));
  price(down(first));
  for (let i = 1; i < source.length; i++) {
    const candle = source[i];
    const close = candle.close;
    if (direction === 0) {
      // The first column starts one box inside the reference and runs to the level reached.
      if (up(close) >= up(first) + 1) start(1, up(first) + 1, up(close), candle.x);
      else if (down(close) <= down(first) - 1) start(-1, down(close), down(first) - 1, candle.x);
      continue;
    }
    if (direction === 1) {
      const level = up(close);
      if (level > top) {
        top = level;
        refresh(candle.x);
      } else if (down(close) <= top - reversal) {
        start(-1, down(close), top - 1, candle.x);
      }
    } else {
      const level = down(close);
      if (level < bottom) {
        bottom = level;
        refresh(candle.x);
      } else if (up(close) >= bottom + reversal) {
        start(1, bottom + 1, up(close), candle.x);
      }
    }
  }

  return columns;
}
