import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describeValue, requireOptions, requireSourceArray } from "./kernels";

/**
 * Line Break (three-line break by default) — a price-axis transform in the
 * Renko lineage: time is thrown away, a line is drawn each time the close
 * beats the last line's close in the running direction, and the direction
 * reverses only when the close beats the extreme of the last `lines` lines.
 * A block's x is an ordinal (0, 1, 2…); `closedAt` is the x of the candle
 * that drew it. Register it as a derivation — see the guide's "Price-axis
 * transforms" — and `candleSeries()` draws the blocks unchanged.
 */
export interface LineBreakBlock extends OHLC {
  /** The block's ordinal — this is the chart's x. */
  x: number;
  /** The x of the source candle that drew this block. The key the axis format uses to recover time. */
  closedAt: number;
  /** Which way the line runs — the up/down slot; `candleSeries` colours a block by close against open, which agrees with it. */
  tone: "up" | "down";
}

export interface LineBreakOptions {
  /**
   * How many of the latest lines (the current one included) a reversal has
   * to beat — the close must cross the lowest low of them to turn down, the
   * highest high to turn up. Default 3: the literature's three-line break.
   */
  lines?: number;
}

/** The defaults: three lines, the literature's three-line break. Single source of truth — see `MACD_DEFAULTS`. */
export const LINE_BREAK_DEFAULTS = { lines: 3 } as const;

/**
 * Close-based, one candle draws at most one line. The first close that
 * differs from the first candle's close sets the direction. In the running
 * direction a close beyond the last line's close draws a new line that opens
 * at the last line's close. Against it, a close beyond the extreme of the last `lines`
 * lines (the current one included; fewer while fewer exist) draws the
 * reversal line — Nison's turnaround line, which opens at the last line's
 * open (the bottom of the highest white line turning down, the top of the
 * lowest black line turning up) and runs to the close. A close inside the
 * band, or exactly on its edge, or equal to the last close, draws nothing.
 * Every block is a well-formed candle: its high and low are its open and
 * close.
 */
export function lineBreak(source: readonly OHLC[], options: LineBreakOptions = {}): LineBreakBlock[] {
  requireSourceArray(source, "lineBreak");
  requireOptions(options, "lineBreak");
  // Only an omitted option takes the default — a JavaScript caller's null is refused like any other non-integer.
  const lines = options.lines === undefined ? LINE_BREAK_DEFAULTS.lines : options.lines;
  if (!Number.isInteger(lines) || lines < 1) {
    throw new ContractError(`lineBreak lines must be a positive integer, got ${describeValue(lines)}`);
  }

  const blocks: LineBreakBlock[] = [];
  if (source.length === 0) return blocks;

  const emit = (open: number, close: number, closedAt: number): void => {
    blocks.push({
      x: blocks.length,
      open,
      close,
      high: Math.max(open, close),
      low: Math.min(open, close),
      closedAt,
      tone: close >= open ? "up" : "down",
    });
  };

  /** The extreme of the last `lines` blocks: the lowest low when running up, the highest high when running down. */
  const extreme = (direction: 1 | -1): number => {
    const from = Math.max(0, blocks.length - lines);
    let value = direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (let i = from; i < blocks.length; i++) {
      const block = blocks[i];
      value = direction === 1 ? Math.min(value, block.low) : Math.max(value, block.high);
    }
    return value;
  };

  let last = source[0].close; // the last line's close — the first candle's close before any line
  let direction: 1 | -1 | 0 = 0;

  for (const candle of source) {
    const close = candle.close;
    if (direction === 0) {
      if (close === last) continue;
      direction = close > last ? 1 : -1;
      emit(last, close, candle.x);
      last = close;
      continue;
    }
    if (direction === 1 ? close > last : close < last) {
      // A new line in the running direction opens at the last close.
      emit(last, close, candle.x);
      last = close;
      continue;
    }
    const band = extreme(direction);
    if (direction === 1 ? close < band : close > band) {
      // The turnaround line opens where the last line opened and turns the direction.
      emit(blocks[blocks.length - 1].open, close, candle.x);
      last = close;
      direction = direction === 1 ? -1 : 1;
    }
  }

  return blocks;
}
