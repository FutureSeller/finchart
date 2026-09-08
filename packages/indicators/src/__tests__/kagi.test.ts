/** Kagi — the numeric ledger: extension, reversal by the amount, shoulders and waists, tone and breakY, ordinal x. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { kagi } from "../kagi";

function tick(x: number, close: number): OHLC {
  return { x, open: close, high: close, low: close, close };
}
const ys = (points: readonly { y: number }[]) => points.map((p) => p.y);
const tones = (points: readonly { tone: string }[]) => points.map((p) => p.tone);

describe("kagi", () => {
  it("refuses a reversal that is not a positive finite number — a JavaScript caller's null and undefined included", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => kagi([tick(0, 10)], { reversal: bad })).toThrow(ContractError);
    }
    const nullish: unknown = null;
    expect(() => kagi([tick(0, 10)], { reversal: nullish as never })).toThrow(ContractError);
    const missing: unknown = {};
    expect(() => kagi([tick(0, 10)], missing as never)).toThrow(ContractError);
  });

  it("an empty tape draws nothing; a single candle is the start point; a flat tape stays a start point", () => {
    expect(kagi([], { reversal: 1 })).toEqual([]);
    expect(kagi([tick(5, 10)], { reversal: 1 })).toEqual([{ x: 0, y: 10, closedAt: 5, tone: "up" }]);
    expect(kagi([tick(0, 10), tick(1, 10), tick(2, 10)], { reversal: 1 })).toEqual([{ x: 0, y: 10, closedAt: 0, tone: "up" }]);
  });

  it("extends in the running direction and turns only after a pullback of `reversal` or more — the vertex is the extreme", () => {
    // 100 → 103 → 106 (extending; the live end moves) → 105.5 (pullback 0.5 < 1: nothing) → 104 (pullback 2 ≥ 1: the
    // vertex at 106 is fixed, a falling segment ends at 104).
    const points = kagi([tick(0, 100), tick(1, 103), tick(2, 106), tick(3, 105.5), tick(4, 104)], { reversal: 1 });
    expect(points.map((p) => [p.x, p.y, p.closedAt])).toEqual([
      [0, 100, 0],
      [1, 106, 2],
      [2, 104, 4],
    ]);
  });

  it("a pullback of exactly `reversal` turns; a hair less does not", () => {
    expect(kagi([tick(0, 100), tick(1, 110), tick(2, 109)], { reversal: 1 })).toHaveLength(3);
    expect(kagi([tick(0, 100), tick(1, 110), tick(2, 109.0001)], { reversal: 1 })).toHaveLength(2);
  });

  it("the first move of at least `reversal` sets the direction and the first segment's tone; the start point carries it", () => {
    const up = kagi([tick(0, 100), tick(1, 101)], { reversal: 1 });
    expect(tones(up)).toEqual(["up", "up"]);
    const down = kagi([tick(0, 100), tick(1, 99)], { reversal: 1 });
    expect(tones(down)).toEqual(["down", "down"]);
    // Nison's first line waits for the reversal amount: 135 → 132 with reversal 4 draws nothing yet, 131 does.
    expect(kagi([tick(0, 135), tick(1, 132)], { reversal: 4 })).toEqual([{ x: 0, y: 135, closedAt: 0, tone: "up" }]);
    expect(ys(kagi([tick(0, 135), tick(1, 132), tick(2, 131)], { reversal: 4 }))).toEqual([135, 131]);
    expect(ys(kagi([tick(0, 135), tick(1, 132), tick(2, 139)], { reversal: 4 }))).toEqual([135, 139]);
  });

  it("a segment already yang stays yang past the previous shoulder — no break is recorded for no change", () => {
    // Up to 110 (shoulder-to-be), down to 100 (waist), up again. The first segment is yang (it rose) and the
    // falling one stays yang (no waist yet to fall under), so the third is yang from its start: rising above the
    // shoulder 110 changes nothing and marks no breakY — a break marks an actual change only.
    const points = kagi([tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 105), tick(4, 111)], { reversal: 1 });
    expect(ys(points)).toEqual([100, 110, 100, 111]);
    expect(tones(points)).toEqual(["up", "up", "up", "up"]);
    // At 105 the third segment had not crossed yet:
    const before = kagi([tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 105)], { reversal: 1 });
    expect(before[3]).toMatchObject({ y: 105, tone: "up" });
    expect(before[3].breakY).toBeUndefined();
    // …so it never turned yin, and rising above 110 changes nothing — breakY only marks an actual change.
    expect(points[3].breakY).toBeUndefined();
  });

  it("a falling segment turns yin below the previous waist; the next rising one turns yang again above the previous shoulder", () => {
    // 100 → 110 (shoulder S1 = 110) → 100 (waist W1 = 100) → 108 (rising, yin? no — still yang: the tone only changes on a
    // crossing, and 108 < S1) → 99 (falling below W1: yin, breakY 100) → 112 (rising above S2 = 108: yang, breakY 108).
    const points = kagi([tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 108), tick(4, 99), tick(5, 112)], { reversal: 1 });
    expect(ys(points)).toEqual([100, 110, 100, 108, 99, 112]);
    expect(tones(points)).toEqual(["up", "up", "up", "up", "down", "up"]);
    expect(points[4].breakY).toBe(100);
    expect(points[5].breakY).toBe(108);
  });

  it("tone is not direction — a falling segment that has not reached the previous waist stays yang", () => {
    // Shoulder 110, waist 100, then up to 120 (yang, above 110), then down to 101 — above the waist 100: still yang.
    const points = kagi([tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 120), tick(4, 101)], { reversal: 1 });
    expect(ys(points)).toEqual([100, 110, 100, 120, 101]);
    expect(points[4]).toMatchObject({ tone: "up" });
    expect(points[4].breakY).toBeUndefined();
    // One more pullback below 100 and it is yin at 100.
    const further = kagi([tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 120), tick(4, 101), tick(5, 99)], { reversal: 1 });
    expect(further[4]).toMatchObject({ y: 99, tone: "down", breakY: 100 });
  });

  it("the crossing is tested against the shoulder or waist that stood when the segment began — not the vertex just left", () => {
    // Up 100 → 110, down to 105, up to 108: the previous shoulder is 110, so 108 is still yang (unchanged), not
    // "crossed the vertex 105 it just left".
    const points = kagi([tick(0, 100), tick(1, 110), tick(2, 105), tick(3, 108)], { reversal: 1 });
    expect(tones(points)).toEqual(["up", "up", "up", "up"]);
    expect(points[3].breakY).toBeUndefined();
    // Down first: 100 → 90 (yin), up to 95 (still yin — no shoulder yet), down to 89 — below the waist 90: yin already,
    // nothing changes; up to 96 — above the shoulder 95: yang, breakY 95.
    const other = kagi([tick(0, 100), tick(1, 90), tick(2, 95), tick(3, 89), tick(4, 96)], { reversal: 1 });
    expect(ys(other)).toEqual([100, 90, 95, 89, 96]);
    expect(tones(other)).toEqual(["down", "down", "down", "down", "up"]);
    expect(other[3].breakY).toBeUndefined();
    expect(other[4].breakY).toBe(95);
  });

  it("a close exactly on the standing shoulder or waist changes nothing — the crossing is strict", () => {
    // Shoulder 110, waist 100, shoulder 108, then yin at 99: rising back to exactly 108 stays yin with no break;
    // 108.01 turns yang with breakY 108.
    const tape = [tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 108), tick(4, 99)];
    const onIt = kagi([...tape, tick(5, 108)], { reversal: 1 });
    expect(onIt.at(-1)).toMatchObject({ y: 108, tone: "down" });
    expect(onIt.at(-1)?.breakY).toBeUndefined();
    expect(kagi([...tape, tick(5, 108.01)], { reversal: 1 }).at(-1)).toMatchObject({ y: 108.01, tone: "up", breakY: 108 });
    // Waist 100, yang at 120: falling to exactly 100 stays yang; 99.99 turns yin with breakY 100.
    const down = [tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 120)];
    const onWaist = kagi([...down, tick(4, 100)], { reversal: 1 });
    expect(onWaist.at(-1)).toMatchObject({ y: 100, tone: "up" });
    expect(onWaist.at(-1)?.breakY).toBeUndefined();
    expect(kagi([...down, tick(4, 99.99)], { reversal: 1 }).at(-1)).toMatchObject({ y: 99.99, tone: "down", breakY: 100 });
  });

  it("each completed falling segment refreshes the waist — a later fall is judged against the newest one", () => {
    // Waists at 100 then 90 (shoulders 110, 120, 130): the fall from 130 to 95 is above the newest waist 90 — still
    // yang, no break; a fall to 89 is below it — yin with breakY 90, not 100.
    const tape = [tick(0, 100), tick(1, 110), tick(2, 100), tick(3, 120), tick(4, 90), tick(5, 130)];
    const above = kagi([...tape, tick(6, 95)], { reversal: 1 });
    expect(ys(above)).toEqual([100, 110, 100, 120, 90, 130, 95]);
    expect(above.at(-1)).toMatchObject({ tone: "up" });
    expect(above.at(-1)?.breakY).toBeUndefined();
    expect(kagi([...tape, tick(6, 89)], { reversal: 1 }).at(-1)).toMatchObject({ y: 89, tone: "down", breakY: 90 });
  });

  it("a close equal to the running extreme moves nothing — not even closedAt", () => {
    const points = kagi([tick(0, 100), tick(1, 110), tick(2, 110), tick(3, 111)], { reversal: 1 });
    expect(points.map((p) => [p.y, p.closedAt])).toEqual([
      [100, 0],
      [111, 3],
    ]);
    expect(kagi([tick(0, 100), tick(1, 110), tick(2, 110)], { reversal: 1 }).at(-1)).toMatchObject({ y: 110, closedAt: 1 });
  });

  it("decides on closes only — wicks never move the line", () => {
    const wick = (x: number, high: number, low: number, close: number): OHLC => ({ x, open: close, high, low, close });
    const points = kagi([wick(0, 200, 0, 100), wick(1, 300, 0, 103), wick(2, 500, -100, 102.5)], { reversal: 1 });
    expect(points.map((p) => [p.y, p.closedAt])).toEqual([
      [100, 0],
      [103, 1],
    ]);
  });

  it("over a long tape: x is 0..n−1, closedAt never decreases, the live end is the last point, one vertex per candle at most", () => {
    const tape = Array.from({ length: 3000 }, (_, i) => tick(i * 60, 100 + Math.sin(i / 9) * 6 + Math.sin(i / 31) * 11 + (i % 5) * 0.3));
    const points = kagi(tape, { reversal: 2 });
    expect(points.length).toBeGreaterThan(20);
    expect(points.map((p) => p.x)).toEqual(points.map((_, i) => i));
    for (let i = 1; i < points.length; i++) expect(points[i].closedAt).toBeGreaterThan(points[i - 1].closedAt);
    for (let i = 1; i < points.length; i++) expect(points[i].y).not.toBe(points[i - 1].y);
    for (const p of points) if (p.breakY !== undefined) expect(p.tone).toBe(p.y > p.breakY ? "up" : "down");
    // Every reversal backed off by at least the amount.
    for (let i = 2; i < points.length; i++) expect(Math.abs(points[i - 1].y - points[i].y)).toBeGreaterThanOrEqual(2);
  });
});
