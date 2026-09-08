/** Point & Figure — the numeric ledger: the grid, growth, the reversal one box inside, floor/ceil levels, ordinal x. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { POINT_AND_FIGURE_DEFAULTS, pointAndFigure } from "../point-and-figure";

/** A candle whose open sits away from its close — the transform must read closes only, so the open is a decoy. */
function tick(x: number, close: number): OHLC {
  return { x, open: close + 7, high: close + 7, low: close - 7, close };
}
const spans = (columns: readonly { low: number; high: number; tone: string }[]) => columns.map((c) => [c.tone, c.low, c.high]);

describe("pointAndFigure", () => {
  it("refuses a box that is not a positive finite number and a reversal that is not a positive integer — null included", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE, 1e-320, 2 ** -1023]) {
      expect(() => pointAndFigure([tick(0, 10)], { boxSize: bad })).toThrow(ContractError);
    }
    // The smallest normal box is accepted (a close of 0 is level 0 — any other price would be too many boxes away);
    // a subnormal one is refused even there, where no level bound would catch it.
    expect(pointAndFigure([tick(0, 0)], { boxSize: 2 ** -1022 })).toEqual([]);
    expect(() => pointAndFigure([tick(0, 0)], { boxSize: Number.MIN_VALUE })).toThrow(ContractError);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => pointAndFigure([tick(0, 10)], { boxSize: 1, reversal: bad })).toThrow(ContractError);
    }
    const nullish: unknown = null;
    expect(() => pointAndFigure([tick(0, 10)], { boxSize: nullish as never })).toThrow(ContractError);
    expect(() => pointAndFigure([tick(0, 10)], { boxSize: 1, reversal: nullish as never })).toThrow(ContractError);
    expect(POINT_AND_FIGURE_DEFAULTS).toEqual({ reversal: 3 });
  });

  it("an empty tape, a single candle and a tape that never reaches a grid level beyond the reference draw no column", () => {
    expect(pointAndFigure([], { boxSize: 1 })).toEqual([]);
    expect(pointAndFigure([tick(0, 100.4)], { boxSize: 1 })).toEqual([]);
    // From 100.4 the next levels are 101 above and 100 below: 100.9 and 100.1 reach neither.
    expect(pointAndFigure([tick(0, 100.4), tick(1, 100.9), tick(2, 100.1)], { boxSize: 1 })).toEqual([]);
    // 100.0 reaches the level below: one O.
    expect(spans(pointAndFigure([tick(0, 100.4), tick(1, 100.0)], { boxSize: 1 }))).toEqual([["down", 100, 100]]);
  });

  it("the first column starts one box inside the reference and runs to the level reached; it grows box by box", () => {
    // Reference 100.4 → level 100. 101.2 reaches level 101: X column 101..101. 103.9 reaches 103: 101..103 (3 boxes).
    const columns = pointAndFigure([tick(0, 100.4), tick(1, 101.2), tick(2, 103.9)], { boxSize: 1 });
    expect(columns).toEqual([{ x: 0, open: 101, close: 103, high: 103, low: 101, closedAt: 2, tone: "up", boxes: 3 }]);
    // Falling first: reference 100.4 → ceil level 101; 99.2 reaches ceil 100: O column 100..100; 97.5 → 98: 98..100.
    const falling = pointAndFigure([tick(0, 100.4), tick(1, 99.2), tick(2, 97.5)], { boxSize: 1 });
    expect(falling).toEqual([{ x: 0, open: 100, close: 98, high: 100, low: 98, closedAt: 2, tone: "down", boxes: 3 }]);
  });

  it("a box is filled only when the close reaches it — floor rising, ceil falling", () => {
    // Rising: 102.99 has not reached 103 (level 102). Falling from an O column: 97.01 has not reached 97 (level 98).
    expect(pointAndFigure([tick(0, 100), tick(1, 101), tick(2, 102.99)], { boxSize: 1 })[0]).toMatchObject({ high: 102, boxes: 2 });
    expect(pointAndFigure([tick(0, 100), tick(1, 99), tick(2, 97.01)], { boxSize: 1 })[0]).toMatchObject({ low: 98, boxes: 2 });
  });

  it("reverses when the close gives back `reversal` boxes from the column's end — the new column starts one box inside", () => {
    // X 101..104 (top 104). A close of 101 reaches level 101 = 104 − 3: the O column runs 103 down to 101.
    const tape = [tick(0, 100), tick(1, 101), tick(2, 104)];
    const reversed = pointAndFigure([...tape, tick(3, 101)], { boxSize: 1 });
    expect(spans(reversed)).toEqual([
      ["up", 101, 104],
      ["down", 101, 103],
    ]);
    expect(reversed[1]).toMatchObject({ x: 1, open: 103, close: 101, boxes: 3, closedAt: 3 });
    // 101.5 reaches ceil 102 = 104 − 2: not enough for a three-box reversal.
    expect(pointAndFigure([...tape, tick(3, 101.5)], { boxSize: 1 })).toHaveLength(1);
    // With reversal: 2 it is.
    expect(spans(pointAndFigure([...tape, tick(3, 101.5)], { boxSize: 1, reversal: 2 }))).toEqual([
      ["up", 101, 104],
      ["down", 102, 103],
    ]);
  });

  it("the falling column mirrors it — growth by ceil, reversal to X's one box above its bottom", () => {
    // O column from reference 110 (ceil 110): 108 → 109..108; 105 → 105..109 (bottom 105). 108 reaches floor 108 =
    // 105 + 3: X column 106..108. Then 109 grows it to 109.
    const columns = pointAndFigure([tick(0, 110), tick(1, 108), tick(2, 105), tick(3, 108), tick(4, 109)], { boxSize: 1 });
    expect(spans(columns)).toEqual([
      ["down", 105, 109],
      ["up", 106, 109],
    ]);
    expect(columns[1]).toMatchObject({ open: 106, close: 109, boxes: 4, closedAt: 4 });
  });

  it("a decimal close on a decimal box's level fills that box — the quotient's last-bit shortfall is not a box", () => {
    // 0.3 / 0.1 is 2.9999999999999996 in doubles; the level is 3 all the same. Exact-decimal ledger, box 0.1, reversal 2:
    // 99.8 → 100: X 99.9..100 (2 boxes); 99.7: O 99.9..99.7 (3); 100.1: X 99.8..100.1 (4).
    expect(pointAndFigure([tick(0, 0.1), tick(1, 0.3)], { boxSize: 0.1 })[0]).toMatchObject({ boxes: 2, low: 0.2, high: 3 * 0.1 });
    const columns = pointAndFigure([tick(0, 99.8), tick(1, 100), tick(2, 99.7), tick(3, 100.1)], { boxSize: 0.1, reversal: 2 });
    expect(columns.map((c) => [c.tone, c.boxes, Math.round(c.low * 10), Math.round(c.high * 10)])).toEqual([
      ["up", 2, 999, 1000],
      ["down", 3, 997, 999],
      ["up", 4, 998, 1001],
    ]);
  });

  it("the snap is the division's rounding only — a close a real fraction short of a level does not fill it", () => {
    // Cent boxes on a large price: 99999.9999 is a ten-thousandth short of 100000.00 — not level 10,000,000.
    const large = pointAndFigure([tick(0, 99999.98), tick(1, 99999.9999)], { boxSize: 0.01 });
    expect(large[0]).toMatchObject({ boxes: 1 });
    expect(Math.round(large[0].high * 100)).toBe(9999999);
    // …while 100000.00 written as the decimal fills it.
    expect(Math.round(pointAndFigure([tick(0, 99999.98), tick(1, 100000)], { boxSize: 0.01 })[0].high * 100)).toBe(10000000);
    // 0.29999999995 is half a billionth short of 0.3 — one box, not two.
    expect(pointAndFigure([tick(0, 0.1), tick(1, 0.29999999995)], { boxSize: 0.1 })[0]).toMatchObject({ boxes: 1 });
  });

  it("a level 2⁴⁷ boxes or more from zero is refused, not drawn — the lone reference candle included, and after the snap", () => {
    expect(() => pointAndFigure([tick(0, 1e300), tick(1, 2e300)], { boxSize: 1e-10 })).toThrow(ContractError);
    expect(() => pointAndFigure([tick(0, 1e300)], { boxSize: 1e-10 })).toThrow(ContractError);
    expect(() => pointAndFigure([tick(0, 2 ** 47), tick(1, 2 ** 47 + 1)], { boxSize: 1 })).toThrow(ContractError);
    expect(() => pointAndFigure([tick(0, 2 ** 47)], { boxSize: 1 })).toThrow(ContractError);
    // 2⁴⁷ − 0.1875 is under the bound, but its quotient is inside the snap window of 2⁴⁷ — judged after the snap.
    expect(() => pointAndFigure([tick(0, 1), tick(1, 2 ** 47 - 0.1875)], { boxSize: 1 })).toThrow(ContractError);
    // Inside the bound a column spanning both sides of zero counts its boxes exactly…
    const wide = pointAndFigure([tick(0, -(2 ** 47 - 1)), tick(1, 2 ** 47 - 1)], { boxSize: 1 });
    expect(wide[0].boxes).toBe(2 ** 48 - 1 - 2 + 1);
    // …and a decimal tie near the top of the range still lands on its own level: 3 × (2⁴⁷ − 5) is exact.
    const near = pointAndFigure([tick(0, 0), tick(1, 3 * (2 ** 47 - 5))], { boxSize: 3 });
    expect(near[0]).toMatchObject({ boxes: 2 ** 47 - 5, high: 3 * (2 ** 47 - 5) });
  });

  it("a box so large that a level's price leaves the double range is refused, not drawn as Infinity", () => {
    // Just above half the largest double: the close MAX_VALUE is level 2, whose price is 2 × boxSize — Infinity.
    const huge = Number.MAX_VALUE / 2 * (1 + 2 ** -52);
    expect(() => pointAndFigure([tick(0, 0), tick(1, Number.MAX_VALUE)], { boxSize: huge })).toThrow(ContractError);
    // The reference candle is held to the same door.
    expect(() => pointAndFigure([tick(0, Number.MAX_VALUE)], { boxSize: huge })).toThrow(ContractError);
  });

  it("the falling-to-rising reversal needs exactly `reversal` boxes — 108 turns, 107.99 does not", () => {
    const tape = [tick(0, 110), tick(1, 108), tick(2, 105)];
    expect(pointAndFigure([...tape, tick(3, 107.99)], { boxSize: 1 })).toHaveLength(1);
    expect(spans(pointAndFigure([...tape, tick(3, 108)], { boxSize: 1 }))).toEqual([
      ["down", 105, 109],
      ["up", 106, 108],
    ]);
  });

  it("a close inside the column moves nothing — not even closedAt — in either direction", () => {
    const columns = pointAndFigure([tick(0, 100), tick(1, 103), tick(2, 102), tick(3, 103), tick(4, 101.2)], { boxSize: 1 });
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({ high: 103, closedAt: 1 });
    // Falling: 97 fills level 97; 98 and a repeated 97 change nothing.
    const falling = pointAndFigure([tick(0, 100), tick(1, 97), tick(2, 98), tick(3, 97), tick(4, 98.8)], { boxSize: 1 });
    expect(falling).toHaveLength(1);
    expect(falling[0]).toMatchObject({ low: 97, closedAt: 1 });
  });

  it("the grid is absolute — boxes sit on multiples of boxSize whatever the history, though the columns themselves are path-dependent", () => {
    // A fractional box: every boundary is a level times 0.25, computed once, not accumulated.
    const tape = [tick(0, 10.1), tick(1, 10.6), tick(2, 11.4), tick(3, 10.3), tick(4, 9.4), tick(5, 10.9)];
    const columns = pointAndFigure(tape, { boxSize: 0.25, reversal: 2 });
    for (const c of columns) {
      expect(Math.abs(c.low - Math.round(c.low / 0.25) * 0.25)).toBeLessThan(1e-12);
      expect(Math.abs(c.high - Math.round(c.high / 0.25) * 0.25)).toBeLessThan(1e-12);
    }
    // Prepending history: the boundaries still sit on the same grid — but the columns can differ well past the
    // seam, because each starts one box inside the previous one's extreme (path dependence, not grid drift).
    const page = [tick(-3, 9.0), tick(-2, 9.9), tick(-1, 10.1)];
    const after = pointAndFigure([...page, ...tape], { boxSize: 0.25, reversal: 2 });
    for (const c of after) {
      expect(Math.abs(c.low - Math.round(c.low / 0.25) * 0.25)).toBeLessThan(1e-12);
      expect(Math.abs(c.high - Math.round(c.high / 0.25) * 0.25)).toBeLessThan(1e-12);
    }
    // Path dependence, shown: box 1, reversal 3 — the page's tall fall (136 → 98) flows into the first column and
    // shifts the extreme every later column starts from: 96..99 (4 boxes) becomes 96..100 (5).
    const original = [tick(0, 100), tick(1, 99), tick(2, 101), tick(3, 96)];
    expect(spans(pointAndFigure(original, { boxSize: 1 }))).toEqual([["down", 96, 99]]);
    expect(spans(pointAndFigure([tick(-3, 136), tick(-2, 98), tick(-1, 100), ...original], { boxSize: 1 }))).toEqual([
      ["down", 98, 135],
      ["up", 99, 101],
      ["down", 96, 100],
    ]);
  });

  it("decides on closes only — wicks never fill a box", () => {
    const wick = (x: number, high: number, low: number, close: number): OHLC => ({ x, open: high - 1, high, low, close });
    const columns = pointAndFigure([wick(0, 200, 0, 100), wick(1, 300, 0, 102), wick(2, 500, -100, 101.5)], { boxSize: 1 });
    expect(spans(columns)).toEqual([["up", 101, 102]]);
    expect(columns[0].closedAt).toBe(1);
  });

  it("over a long tape: x is 0..n−1, closedAt never decreases, columns alternate and each holds at least one box, boundaries on the grid", () => {
    const tape = Array.from({ length: 3000 }, (_, i) => tick(i * 60, 100 + Math.sin(i / 9) * 6 + Math.sin(i / 31) * 11 + (i % 5) * 0.3));
    const columns = pointAndFigure(tape, { boxSize: 0.5 });
    expect(columns.length).toBeGreaterThan(20);
    expect(columns.map((c) => c.x)).toEqual(columns.map((_, i) => i));
    for (let i = 1; i < columns.length; i++) {
      expect(columns[i].closedAt).toBeGreaterThan(columns[i - 1].closedAt);
      expect(columns[i].tone).not.toBe(columns[i - 1].tone);
    }
    for (const c of columns) {
      expect(c.boxes).toBeGreaterThanOrEqual(1);
      expect(c.high - c.low).toBeCloseTo((c.boxes - 1) * 0.5, 9);
      expect(c.low).toBe(Math.min(c.open, c.close));
      expect(c.high).toBe(Math.max(c.open, c.close));
      expect(c.tone).toBe(c.close >= c.open ? "up" : "down");
    }
  });
});
