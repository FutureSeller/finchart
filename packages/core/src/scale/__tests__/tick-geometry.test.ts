import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import { LogScale } from "../log-scale";

/**
 * Pins the numeric table in log-ticks-approach-2026-09-02.md §2c — the
 * approach declared "tests fix this table verbatim", so every literal
 * here traces to a line of that table. The scale under test is set up
 * the way `Pane` does it: a y range of `[bottom, top]` (reversed), so
 * these tests also pin that the geometry survives the reversed range
 * without a sign contract on the caller.
 */
function logScale(
  domainMin: number,
  domainMax: number,
  spanPx = 564,
): LogScale {
  // [bottom, top] — the default (non-inverted) pane orientation.
  return new LogScale(domainMin, domainMax, spanPx + 8, 8);
}

const SPACING = 40;

describe("LogScale.tickGeometry — placement", () => {
  it("fills the reviewed domain with the 1·2·5 ladder (R1's two symptoms)", () => {
    // Review-measured domain: 156.7 px/decade ≥ 133 → full {1,2,5}.
    const geometry = logScale(0.5011, 1995.3).tickGeometry(SPACING);
    expect(geometry.values()).toEqual([
      1, 2, 5, 10, 20, 50, 100, 200, 500, 1000,
    ]);
  });

  it("keeps the inner set fixed when the lower bound moves (pan stability)", () => {
    // 88.9 px/decade → decade-only band. A 20% move of the lower bound
    // must not reshuffle the interior — the old greedy filter anchored
    // to the domain edge and swapped all ten labels here.
    const before = logScale(0.05, 110000).tickGeometry(SPACING).values();
    const after = logScale(0.06, 110000).tickGeometry(SPACING).values();
    expect(before).toEqual([0.1, 1, 10, 100, 1000, 10000, 100000]);
    expect(after).toEqual(before);
  });

  it("does not snap at the old d = 1 threshold", () => {
    // The v1 rule flipped from linear to ladder at exactly one decade,
    // collapsing 9 ticks to 4 on a 6% zoom-out. The single predicate
    // (whichever candidate keeps more ticks) answers the same on both
    // sides of that boundary.
    const below = logScale(1, 9.9).tickGeometry(SPACING).values();
    const above = logScale(1, 10.5).tickGeometry(SPACING).values();
    expect(below).toEqual([1, 2, 3, 4, 5, 6]);
    expect(above).toEqual(below);
  });

  it("prefers the ladder when the linear candidate thins out on top", () => {
    // Two decades: linear step 10 survives only to 30 (the log top
    // compresses), the ladder spreads seven round numbers instead.
    const geometry = logScale(1, 100).tickGeometry(SPACING);
    expect(geometry.values()).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  it("skips decades with an absolute anchor when even decades don't fit", () => {
    // 564px over ~12 decades ≈ 47px/decade… narrow it: use a 240px span
    // → 20px/decade → skip n = 2, anchored at k ≡ 0 (mod 2), not at
    // the domain's edge.
    const geometry = logScale(1e-6, 1e6, 240).tickGeometry(SPACING);
    expect(geometry.values()).toEqual([1e-6, 1e-4, 0.01, 1, 100, 10000, 1e6]);
    // Anchor is absolute: moving the floor a decade up keeps even ks.
    const moved = logScale(1e-5, 1e6, 240).tickGeometry(SPACING).values();
    expect(moved).toEqual([1e-4, 0.01, 1, 100, 10000, 1e6]);
  });

  it("caps values() at 1,000 ticks", () => {
    // A pathological span affords the full ladder over hundreds of
    // decades — the linear axis earned this cap from a real OOM, and
    // this path leaves that door.
    const geometry = logScale(1e-300, 1e300, 100000).tickGeometry(SPACING);
    // Exactly the cap — not less. A lesser count would mean the ladder
    // collapsed (the log10(max/min) overflow once made this 0, and a
    // ≤-assertion waved it through).
    expect(geometry.values().length).toBe(1000);
  });

  it("emits values without float noise", () => {
    // 2 × 10⁻¹ and friends must come out as the literals a label prints.
    const values = logScale(0.15, 60).tickGeometry(SPACING).values();
    expect(values).toEqual([0.2, 0.5, 1, 2, 5, 10, 20, 50]);
  });
});

describe("LogScale.tickGeometry — stepAt", () => {
  it("answers the decade of the value inside the visible domain", () => {
    const geometry = logScale(0.5011, 1995.3).tickGeometry(SPACING);
    expect(geometry.stepAt(9.9)).toBe(1);
    expect(geometry.stepAt(10)).toBe(10);
  });

  it("clamps to the visible domain's decade range", () => {
    // Out-of-domain values (a legend row, a tooltip sample) answer with
    // the nearest visible decade — one rule, no sign special-case.
    const geometry = logScale(1, 100).tickGeometry(SPACING);
    expect(geometry.stepAt(3000)).toBe(100);
    expect(geometry.stepAt(1e-8)).toBe(1);
    expect(geometry.stepAt(0)).toBe(1);
    expect(geometry.stepAt(-5)).toBe(1);
    expect(geometry.stepAt(Number.NaN)).toBe(1);
  });

  it("keeps the tiny-value gain the badge change exists for", () => {
    // Domain [0.00001, 0.1]: today's linear ruler says step 0.01 and
    // every badge reads "0.00". The local decade is 0.00001.
    const geometry = logScale(0.00001, 0.1).tickGeometry(SPACING);
    expect(geometry.stepAt(0.00003)).toBe(0.00001);
  });

  it("returns the linear step when the linear candidate won", () => {
    const geometry = logScale(1, 2).tickGeometry(SPACING);
    // Sub-decade window: linear candidates (step 0.1) all fit.
    expect(geometry.values()).toEqual([
      1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2,
    ]);
    expect(geometry.stepAt(1.234)).toBe(0.1);
  });

  it("stays positive and finite for any input", () => {
    const geometry = logScale(0.5011, 1995.3).tickGeometry(SPACING);
    for (const v of [0, -1, Number.MIN_VALUE, 1e308, Number.NaN, Infinity]) {
      const step = geometry.stepAt(v);
      expect(Number.isFinite(step)).toBe(true);
      expect(step).toBeGreaterThan(0);
    }
  });
});

describe("LogScale.tickGeometry — contract", () => {
  const DOMAINS: [number, number, number?][] = [
    [0.5011, 1995.3],
    [0.05, 110000],
    [1, 9.9],
    [1, 10.5],
    [1, 2],
    [1, 100],
    [0.00001, 0.1],
    [1e-6, 1e6, 240],
    [7.3, 7.4],
    [3, 30000],
  ];

  it.each(DOMAINS)(
    "values() on [%f, %f] is ascending, finite, spaced, and capped",
    (min, max, span) => {
      const scale = logScale(min, max, span);
      const values = scale.tickGeometry(SPACING).values();
      expect(values.length).toBeLessThanOrEqual(1000);
      for (let i = 0; i < values.length; i++) {
        expect(Number.isFinite(values[i])).toBe(true);
        expect(values[i]).toBeGreaterThanOrEqual(min);
        expect(values[i]).toBeLessThanOrEqual(max);
        if (i > 0) {
          expect(values[i]).toBeGreaterThan(values[i - 1]);
          const gap = Math.abs(
            scale.scale(values[i]) - scale.scale(values[i - 1]),
          );
          expect(gap).toBeGreaterThanOrEqual(SPACING - 1e-9);
        }
      }
    },
  );

  it("rejects a non-positive or non-finite spacing at the door", () => {
    const scale = logScale(1, 100);
    for (const bad of [0, -40, Number.NaN, Infinity]) {
      expect(() => scale.tickGeometry(bad)).toThrow(ContractError);
    }
  });
});
