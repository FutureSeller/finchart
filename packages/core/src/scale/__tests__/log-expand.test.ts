/**
 * Padding on a log axis has to be multiplicative. Using the
 * linear additive padding rule (`[min - span·r, max + span·r]`) on a log
 * axis pushes the lower bound past zero once `max/min > 11x`:
 * `min - r·(max-min) <= 0` iff `max/min >= (1+r)/r`, which is 11 when
 * `r = 0.1`. So this was an axis that only threw for the data that actually
 * needed log scaling.
 */
import { describe, expect, it } from "vitest";
import { LinearScale, LogScale } from "..";
import type { Scale } from "..";
import { expandFor, expandRange } from "../../plot/range";

/** `Pane`'s default `valuePadding`. */
const PADDING = 0.1;

describe("the crash condition is gone", () => {
  it.each([
    ["narrow range (1.2x)", 50, 60],
    ["10-year stock (30x)", 10, 300],
    ["BTC (23x)", 3_000, 70_000],
    ["extreme (1000x)", 1, 1_000],
  ])("should stay positive for %s", (_label, min, max) => {
    const scale = new LogScale();
    const [lo, hi] = expandFor(scale, { min, max }, PADDING);

    // This is the contract — the expanded result must pass its own setDomain.
    expect(lo).toBeGreaterThan(0);
    expect(() => scale.setDomain(lo, hi)).not.toThrow();

    // And it actually has to contain the data.
    expect(lo).toBeLessThan(min);
    expect(hi).toBeGreaterThan(max);
  });

  /** What would have happened with linear arithmetic — kept as a regression baseline. */
  it.each([
    ["10-year stock", 10, 300],
    ["BTC", 3_000, 70_000],
  ])("should show why the additive rule failed for %s", (_label, min, max) => {
    const [lo] = expandRange({ min, max }, PADDING);
    expect(lo).toBeLessThanOrEqual(0);
    expect(() => new LogScale().setDomain(lo, max)).toThrow();
  });
});

describe("properties of multiplicative padding", () => {
  it("should expand symmetrically in log space", () => {
    const [lo, hi] = expandFor(new LogScale(), { min: 10, max: 1000 }, PADDING);
    // Equal distance above and below in log space — meaning equal visual margin above and below on screen.
    expect(Math.log(10) - Math.log(lo)).toBeCloseTo(
      Math.log(hi) - Math.log(1000),
      9,
    );
  });

  it("should never cross zero however extreme the ratio", () => {
    const [lo] = expandFor(new LogScale(), { min: 1e-6, max: 1e6 }, 5);
    expect(lo).toBeGreaterThan(0);
  });

  it("should widen a collapsed domain multiplicatively", () => {
    const [lo, hi] = expandFor(new LogScale(), { min: 42, max: 42 }, PADDING);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(42);
    expect(hi).toBeGreaterThan(42);
  });
});

describe("linear is unchanged", () => {
  /** `expand` is an **optional method** — not implementing it keeps the old arithmetic. */
  it("should leave LinearScale on the additive rule", () => {
    // Viewed through the contract type — the implementing class doesn't declare this method at all.
    const linear: Scale = new LinearScale();
    expect(linear.expand).toBeUndefined();
    expect(expandFor(new LinearScale(), { min: 0, max: 100 }, PADDING)).toEqual([
      -10, 110,
    ]);
  });

  it("should keep the collapsed-domain fallback", () => {
    expect(expandFor(new LinearScale(), { min: 5, max: 5 }, PADDING)).toEqual([
      4, 6,
    ]);
  });
});

/**
 * A hint equal to the upper bound still isn't discarded. When `floor < max`,
 * the fallback happened to give the worst possible answer: in a range where
 * every visible positive value is identical (a flat stretch, or zero volume
 * mixed into a flat section), the hint got discarded and it fell back to a
 * constant, sticking the real bar to the top. That's a discontinuity where
 * floor = 99 is correct but floor = 100 is the worst case.
 */
describe("boundary of the positive-value hint", () => {
  const hint = (value: number | null) => ({ minPositive: () => value });

  it("should use a floor that equals the upper bound", () => {
    const scale = new LogScale();

    // All the same value — falls into the answer the `min === max` branch already has.
    expect(scale.expand([0, 100], 0.05, hint(100))).toEqual([50, 200]);
  });

  it("should stay continuous just below the upper bound", () => {
    const scale = new LogScale();
    const [low] = scale.expand([0, 100], 0.05, hint(99));

    // The answer that was correct at 99 doesn't suddenly drop to 0.07 at 100.
    expect(low).toBeGreaterThan(50);
  });

  it("should fall back when there is nothing positive to stand on", () => {
    const scale = new LogScale();
    const [low] = scale.expand([0, 150], 0.05, hint(null));

    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(1);
  });
});

/**
 * The spot where the constant fallback collapses to zero.
 * `max / LOG_FLOOR_DECADES` underflows to 0 when `max` is a denormalized
 * number — and then `expand([0, max])` would call itself again with the
 * same arguments, overflowing the stack. With nowhere lower to go, it
 * expands upward only.
 */
describe("range where the floor underflows", () => {
  it("should terminate instead of recursing forever", () => {
    const scale = new LogScale();

    // A number where both `max / 1000` and `max / 2` are 0. Before the fix, the stack overflowed here.
    const [low, high] = scale.expand([0, Number.MIN_VALUE], 0.05);

    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  it("should keep the halving rule wherever it is representable", () => {
    const scale = new LogScale();

    // The branch above doesn't touch the ×/÷2 arithmetic of an ordinary range.
    expect(scale.expand([100, 100], 0.05)).toEqual([50, 200]);
  });

  it("the factor branch doesn't collapse to zero either", () => {
    const scale = new LogScale();

    // factor = (max/min)^ratio ~= 31.6 — a range where min/factor used to
    // fall below half the smallest denormalized number and underflow to 0.
    // If it becomes 0, setDomain rejects it on the render path.
    const [low, high] = scale.expand([5e-324, 5e-321], 0.5);

    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });
});
