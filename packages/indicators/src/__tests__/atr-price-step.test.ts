/** atrPriceStep — the doors, the last ATR, and a hand ledger that does not share the kernels' arithmetic. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { atrPriceStep } from "../atr-price-step";
import { atr } from "../factories";
import { kagi } from "../kagi";
import { pointAndFigure } from "../point-and-figure";
import { renko } from "../renko";

const bar = (x: number, high: number, low: number, close: number): OHLC => ({ x, open: close, high, low, close });
/**
 * The ledger, by hand (Wilder): TR₀ = high − low = 4; TR₁ = max(4, |15−10|, |11−10|) = 5; TR₂ = max(3, |16−14|,
 * |13−14|) = 3; TR₃ = max(5, |14−13|, |9−13|) = 5; TR₄ = max(3, |13−12|, |10−12|) = 3. ATR(3): seed (4+5+3)/3 = 4;
 * then (4·2 + 5)/3 = 13/3; then (13/3·2 + 3)/3 = 35/9.
 */
const tape = [bar(0, 12, 8, 10), bar(1, 15, 11, 14), bar(2, 16, 13, 13), bar(3, 14, 9, 12), bar(4, 13, 10, 11)];

describe("atrPriceStep", () => {
  it("is the last ATR of the tape — by the hand ledger, and equal to what atr() reads", () => {
    expect(atrPriceStep(tape, { period: 3 })).toBeCloseTo(35 / 9, 12);
    expect(atrPriceStep(tape.slice(0, 4), { period: 3 })).toBeCloseTo(13 / 3, 12);
    expect(atrPriceStep(tape.slice(0, 3), { period: 3 })).toBe(4);
    const computed = atr({ read: () => tape }, { period: 3 }).out.atr.read();
    expect(atrPriceStep(tape, { period: 3 })).toBe(computed[computed.length - 1].y);
    // A step of 1 is the last true range itself.
    expect(atrPriceStep(tape, { period: 1 })).toBe(3);
  });

  it("refuses a period that is not a positive integer — omitted and null included — and a source that is not an array", () => {
    // The period's own door speaks, not a later one that happens to trip on the same input.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => atrPriceStep(tape, { period: bad })).toThrow(new RegExp(`period must be an integer of at least 1, got ${bad}`));
    }
    expect(() => Reflect.apply(atrPriceStep, undefined, [tape, {}])).toThrow(/period must be an integer/);
    expect(() => Reflect.apply(atrPriceStep, undefined, [tape, { period: null }])).toThrow(/period must be an integer/);
    expect(() => Reflect.apply(atrPriceStep, undefined, [tape, null])).toThrow(ContractError);
    expect(() => Reflect.apply(atrPriceStep, undefined, [null, { period: 3 }])).toThrow(ContractError);
  });

  it("refuses fewer bars than the period — the ATR seeds on `period` true ranges, so `period` bars is the least", () => {
    expect(() => atrPriceStep(tape.slice(0, 2), { period: 3 })).toThrow(/^atrPriceStep needs at least 3 bars for an ATR\(3\), got 2$/);
    expect(() => atrPriceStep([], { period: 1 })).toThrow(ContractError);
    expect(atrPriceStep(tape.slice(0, 3), { period: 3 })).toBe(4);
  });

  it("refuses an ATR that is no step — 0 on a flat tape, or below the smallest step the transforms take — so none of them fails under its own name", () => {
    const flat = [bar(0, 10, 10, 10), bar(1, 10, 10, 10), bar(2, 10, 10, 10)];
    expect(() => atrPriceStep(flat, { period: 3 })).toThrow(/^atrPriceStep found an ATR\(3\) of 0 — no step: a flat tape has none, and the strictest transform requires a positive normal number \(2⁻¹⁰²² or more\)$/);
    // A tape whose whole range is the smallest subnormal: an ATR, but not one `pointAndFigure` could grid on.
    const hairline = [{ x: 0, open: 0, high: Number.MIN_VALUE, low: 0, close: 0 }];
    expect(() => atrPriceStep(hairline, { period: 1 })).toThrow(/no step/);
    const tiny = [{ x: 0, open: 0, high: 1e-310, low: 0, close: 0 }];
    expect(() => atrPriceStep(tiny, { period: 1 })).toThrow(/no step/);
    // Over half the largest double no reversal fits the doubles: `renko`'s own door — held here too.
    const vast = [{ x: 0, open: 0, high: 1e308, low: 0, close: 0 }];
    expect(() => atrPriceStep(vast, { period: 1 })).toThrow(/^atrPriceStep found an ATR\(1\) of 1e\+308 — no step: past half the largest double renko cannot lay its two-brick reversal$/);
    const halfLess = [{ x: 0, open: 0, high: Number.MAX_VALUE / 2, low: 0, close: 0 }];
    expect(() => renko(halfLess, { brickSize: atrPriceStep(halfLess, { period: 1 }) })).not.toThrow();
    // Flat only at the end still has an average move: TR₅ = 0, so (35/9 · 2 + 0)/3 = 70/27.
    expect(atrPriceStep([...tape, bar(5, 11, 11, 11)], { period: 3 })).toBeCloseTo(70 / 27, 12);
    // What comes out passes every transform's option door…
    // …including the very smallest step there is, the least normal double.
    const cases: [OHLC[], number][] = [[tape, 1], [[...tape, bar(5, 11, 11, 11)], 3], [[{ x: 0, open: 0, high: 2 ** -1022, low: 0, close: 0 }], 1]];
    for (const [source, period] of cases) {
      const step = atrPriceStep(source, { period });
      expect(() => renko(source, { brickSize: step })).not.toThrow();
      expect(() => kagi(source, { reversal: step })).not.toThrow();
      expect(() => pointAndFigure(source, { boxSize: step })).not.toThrow();
    }
    // …while `renko` and `pointAndFigure` also hold the prices: a step of 16,384 on a price of 10²⁰ is 6 × 10¹⁵ steps
    // from zero, past their 2⁴⁷ — those doors are the transforms' own, raised under their own names. (Before its
    // door, `renko` looped forever on such a step: the brick was under the doubles' spacing at that price.)
    const far = [{ x: 0, open: 1e20, high: 1e20 + 16384, low: 1e20, close: 1e20 }];
    const farStep = atrPriceStep(far, { period: 1 });
    expect(farStep).toBe(16384);
    expect(() => renko(far, { brickSize: farStep })).toThrow(/^renko brickSize 16384 is too small to step the price 100000000000000000000$/);
    expect(() => kagi(far, { reversal: farStep })).not.toThrow();
    expect(() => pointAndFigure(far, { boxSize: farStep })).toThrow(/pointAndFigure boxSize .* too small to quantise/);
    // The ten-bar shape that used to hang: one jump of 16,384 at 10²⁰, then flat — ATR(10) = 1,638.4, absorbed at 10²⁰.
    const hang = [{ x: 0, open: 1e20, high: 1e20, low: 1e20, close: 1e20 }, ...Array.from({ length: 9 }, (_, i) => ({ x: i + 1, open: 1e20 + 16384, high: 1e20 + 16384, low: 1e20 + 16384, close: 1e20 + 16384 }))];
    expect(atrPriceStep(hang, { period: 10 })).toBeCloseTo(1638.4, 9);
    expect(() => renko(hang, { brickSize: 1638.4 })).toThrow(/too small to step the price/);
  });
});
