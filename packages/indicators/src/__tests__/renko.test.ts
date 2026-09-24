/** Renko — the numeric ledger: runs, reversal gaps, multi-brick candles, ordinal x. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { renko } from "../renko";

function tick(x: number, close: number): OHLC {
  return { x, open: close, high: close, low: close, close };
}

describe("renko", () => {
  it("refuses a close 2⁴⁷ bricks or more from zero — a brick under the doubles' spacing there could not move the level", () => {
    const at = (x: number, close: number): OHLC => ({ x, open: close, high: close, low: close, close });
    expect(() => renko([at(0, 1e20), at(1, 1e20 + 16384)], { brickSize: 1638.4 })).toThrow(ContractError);
    expect(() => renko([at(0, 2 ** 47)], { brickSize: 1 })).toThrow(/too small to step the price/);
    // A brick over half the largest double has no reversal inside the doubles (it used to lay one at −∞); under
    // that, every brick lies between the level and a finite close, so a tape from −1.5e308 to 1.5e308 and back
    // is laid in finite bricks, reversal included.
    expect(() => renko([at(0, -1e308), at(1, 1e308), at(2, -1e308)], { brickSize: 1e308 })).toThrow(/at most half the largest double/);
    const quarter = Number.MAX_VALUE / 4;
    const laid = renko([at(0, -1.5e308), at(1, 1.5e308), at(2, -1.5e308)], { brickSize: quarter });
    expect(laid.length).toBeGreaterThan(6);
    for (const brick of laid) expect(Number.isFinite(brick.open) && Number.isFinite(brick.close)).toBe(true);
    // Just inside the door the bricks are laid as ever — three of them, one price unit each.
    expect(renko([at(0, 2 ** 47 - 5), at(1, 2 ** 47 - 2)], { brickSize: 1 })).toHaveLength(3);
  });

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


describe("fractional Renko grid", () => {
  it("lays exact decimal boundaries without accepting the preceding double", () => {
    for (const sign of [1, -1]) {
      const below = renko([tick(0, 0), tick(1, sign * 0.29999999999999993)], { brickSize: 0.1 });
      expect(below).toHaveLength(2);
      const exact = renko([tick(0, 0), tick(1, sign * 0.3)], { brickSize: 0.1 });
      expect(exact.map(brick => brick.close)).toEqual([sign * 0.1, sign * 0.2, sign * 0.3]);
    }
  });

  it("keeps a decimal baseline and the two-brick reversal threshold", () => {
    const before = [tick(0, 100.1), tick(1, 100.4), tick(2, 100.20000000000002)];
    expect(renko(before, { brickSize: 0.1 })).toHaveLength(3);
    const bricks = renko([...before, tick(3, 100.2)], { brickSize: 0.1 });
    expect(bricks.map(brick => [brick.open, brick.close])).toEqual([
      [100.1, 100.2], [100.2, 100.3], [100.3, 100.4], [100.3, 100.2],
    ]);
    expect(bricks.at(-1)?.closedAt).toBe(3);
  });
});


it("uses the rounded grid boundary for high-precision and subnormal sizes", () => {
  for (const brickSize of [0.10000000000000002, Math.PI, Number.MIN_VALUE]) {
    const close = brickSize * 3;
    const bricks = renko([tick(0, 0), tick(1, close)], { brickSize });
    expect(bricks).toHaveLength(3);
    expect(bricks.at(-1)?.close).toBe(close);
  }
});

it("preserves a single-double boundary distinction at large offsets and on upward reversal", () => {
  expect(renko([tick(0, 1e12), tick(1, 1000000000000.2999)], { brickSize: 0.1 })).toHaveLength(2);
  expect(renko([tick(0, 1e12), tick(1, 1000000000000.3)], { brickSize: 0.1 })).toHaveLength(3);
  const before = [tick(0, -100.1), tick(1, -100.4), tick(2, -100.20000000000002)];
  expect(renko(before, { brickSize: 0.1 })).toHaveLength(3);
  const bricks = renko([...before, tick(3, -100.2)], { brickSize: 0.1 });
  expect(bricks.at(-1)).toMatchObject({ open: -100.3, close: -100.2, closedAt: 3 });
  expect(bricks).toHaveLength(4);
});


it("counts subnormal bricks in their exact binary units across a long run", () => {
  for (const brickSize of [Number.MIN_VALUE, 1e-323, 1e-320]) {
    for (const sign of [1, -1]) {
      const end = sign * brickSize * 100;
      const bricks = renko([tick(0, 0), tick(1, end)], { brickSize });
      expect(bricks).toHaveLength(100);
      expect(bricks.at(-1)?.close).toBe(end);
      const reversed = renko([tick(0, 0), tick(1, end), tick(2, end - sign * brickSize * 2)], { brickSize });
      expect(reversed).toHaveLength(101);
    }
  }
});
