/** Renko — the numeric ledger: runs, reversal gaps, multi-brick candles, ordinal x. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { renko } from "../renko";

function tick(x: number, close: number): OHLC {
  return { x, open: close, high: close, low: close, close };
}

describe("renko", () => {
  it("should refuse a non-positive brick size", () => {
    expect(() => renko([tick(0, 10)], { brickSize: 0 })).toThrow(ContractError);
  });

  it("should emit one brick per size step and share closedAt within one candle", () => {
    // 10 → 12: one candle produces two bricks (10→11, 11→12).
    const bricks = renko([tick(0, 10), tick(1, 10.5), tick(2, 12)], {
      brickSize: 1,
    });

    expect(bricks.map((brick) => brick.x)).toEqual([0, 1]); // ordinal x
    expect(bricks.map((brick) => [brick.open, brick.close])).toEqual([
      [10, 11],
      [11, 12],
    ]);
    expect(bricks.map((brick) => brick.closedAt)).toEqual([2, 2]);
  });

  it("should reverse only after 2×brick, opening with a one-brick gap", () => {
    const closes = [tick(0, 10), tick(1, 12), tick(2, 11.4), tick(3, 9)];
    const bricks = renko(closes, { brickSize: 1 });

    // Two up bricks (10→11→12); 11.4 falls short of a reversal (needs
    // 2 steps = 10 or below); reverses at 9: with a one-brick gap,
    // 11→10, then 10→9.
    expect(bricks.map((brick) => [brick.open, brick.close])).toEqual([
      [10, 11],
      [11, 12],
      [11, 10],
      [10, 9],
    ]);
    expect(bricks[2].closedAt).toBe(3);
  });

  it("should stay silent while price wanders inside one brick", () => {
    const bricks = renko(
      [tick(0, 10), tick(1, 10.9), tick(2, 9.2), tick(3, 10.5)],
      { brickSize: 1 },
    );

    expect(bricks).toEqual([]);
  });

  it("should flip and keep stacking bricks within one crashing candle", () => {
    // Crashes from 12 to 7 — after the reversal (11→10), three more
    // consecutive steps land within the same candle.
    const bricks = renko([tick(0, 10), tick(1, 12), tick(2, 7)], {
      brickSize: 1,
    });

    expect(bricks.map((brick) => [brick.open, brick.close])).toEqual([
      [10, 11],
      [11, 12],
      [11, 10],
      [10, 9],
      [9, 8],
      [8, 7],
    ]);
    expect(bricks.slice(2).every((brick) => brick.closedAt === 2)).toBe(true);
  });
});
