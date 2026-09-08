import { beforeEach, describe, expect, it } from "vitest";
import { createPlotModel, lineSeries } from "../../index";
import { expandRange } from "../../plot/range";

/** The double just above `x` — by its bits, not by an epsilon, which steps two ulps for half the mantissas. */
function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}
import { LinearScale } from "../linear-scale";
import { LogScale } from "../log-scale";

describe("LinearScale", () => {
  let scale: LinearScale;

  beforeEach(() => {
    // data: 0-100, screen: 0-800
    scale = new LinearScale(0, 100, 0, 800);
  });

  describe("scale", () => {
    it("should map a data value to a screen value", () => {
      expect(scale.scale(50)).toBe(400);
    });

    it("should map domain bounds to range bounds", () => {
      expect(scale.scale(0)).toBe(0);
      expect(scale.scale(100)).toBe(800);
    });

    it("should extrapolate values outside the domain", () => {
      expect(scale.scale(150)).toBe(1200);
    });
  });

  describe("invert", () => {
    it("should map a screen value back to a data value", () => {
      expect(scale.invert(400)).toBe(50);
    });

    it("should map range bounds back to domain bounds", () => {
      expect(scale.invert(0)).toBe(0);
      expect(scale.invert(800)).toBe(100);
    });
  });

  describe("mutation", () => {
    it("should remap after setDomain (pan/zoom)", () => {
      scale.setDomain(0, 200);

      expect(scale.scale(100)).toBe(400);
      expect(scale.getDomain()).toEqual([0, 200]);
    });

    it("should remap after setRange", () => {
      scale.setRange(0, 400);

      expect(scale.scale(50)).toBe(200);
      expect(scale.getRange()).toEqual([0, 400]);
    });

    it("should not expose internal arrays", () => {
      const domain = scale.getDomain();
      domain[0] = 999;

      expect(scale.getDomain()).toEqual([0, 100]);
    });
  });

  describe("validation", () => {
    it("should throw if domain min >= max", () => {
      expect(() => new LinearScale(100, 100, 0, 800)).toThrow();
      expect(() => new LinearScale(100, 50, 0, 800)).toThrow();
      expect(() => scale.setDomain(10, 10)).toThrow();
    });

    it("should throw if range start equals end", () => {
      expect(() => new LinearScale(0, 100, 800, 800)).toThrow();
      expect(() => scale.setRange(800, 800)).toThrow();
    });

    it("should allow an inverted range for downward screen axes", () => {
      // y axis: the domain max must land at the top of the screen (small coord).
      scale.setRange(600, 0);

      expect(scale.scale(0)).toBe(600);
      expect(scale.scale(100)).toBe(0);
      expect(scale.invert(600)).toBe(0);
      expect(scale.invert(0)).toBe(100);
    });

    it("should default to a usable scale with no args", () => {
      const bare = new LinearScale();

      expect(bare.getDomain()).toEqual([0, 1]);
      expect(bare.getRange()).toEqual([0, 1]);
    });
  });
});

describe("LogScale", () => {
  let scale: LogScale;

  beforeEach(() => {
    // data: 1-100 (log requires positive values), screen: 0-800
    scale = new LogScale(1, 100, 0, 800);
  });

  describe("scale", () => {
    it("should map logarithmically", () => {
      // log(10) ≈ 2.303, log(1) = 0, log(100) ≈ 4.605 → ratio ≈ 0.5
      expect(scale.scale(10)).toBeCloseTo(400, 1);
    });

    it("should map domain bounds to range bounds", () => {
      expect(scale.scale(1)).toBe(0);
      expect(scale.scale(100)).toBe(800);
    });

    /**
     * This used to throw — a single `close: 0` bar killed the whole frame,
     * which also contradicted the stance that "toggling an axis is a
     * transformation, not a failure."
     *
     * On a log axis, 0 is a value infinitely far below, not a contract
     * violation. So it gets the same treatment as an off-screen value on a
     * linear axis: a pixel comes out, it's just outside the visible area.
     * The real contract violation (a domain with no positive values at all)
     * is still rejected by `setDomain`.
     */
    it("should push non-positive values off the axis instead of throwing", () => {
      for (const value of [-10, 0]) {
        const pixel = scale.scale(value);
        expect(Number.isFinite(pixel)).toBe(true);
        /**
         * "Below" isn't the right word here — it's "outside the domain's
         * lower bound." This fixture has `range = [0, 800]`, so the domain
         * minimum (1) maps to pixel 0 — i.e. small values sit at the top of
         * the screen. So a value below 0 also lands off-screen toward the
         * top (a negative pixel). The old assertion was `> 800`, which would
         * only hold if the formula were anchored on `rangeMax` — and that
         * formula was wrong for the direction a real chart actually wires
         * things up (see the `it.each` below).
         */
        expect(pixel).toBeLessThan(0);
      }
    });

    /**
     * This also has to go off-screen in the direction a real pane wires
     * things up. The fixture in the test right above has `range = [0, 800]`,
     * so `rangeMax` is at the bottom — but the direction a chart actually
     * uses is the opposite: `pane.ts`'s non-inverted branch calls
     * `setRange(area.bottom, area.top)`, so `rangeMin` is at the bottom. The
     * old formula (`rangeMax + |rangeMax - rangeMin|`) only worked for this
     * one fixture. This checks both.
     */
    it.each([
      ["non-inverted pane — setRange(bottom, top)", 600, 0],
      ["inverted pane — setRange(top, bottom)", 0, 600],
    ])("should leave the visible area in both orientations (%s)", (
      _label,
      rangeStart,
      rangeEnd,
    ) => {
      const oriented = new LogScale(1, 100, rangeStart, rangeEnd);
      const top = Math.min(rangeStart, rangeEnd);
      const bottom = Math.max(rangeStart, rangeEnd);

      for (const value of [-10, 0]) {
        const pixel = oriented.scale(value);
        expect(Number.isFinite(pixel)).toBe(true);
        // If it lands on-screen, the bar gets drawn stuck to the axis line —
        // that's exactly what this branch guards against.
        expect(pixel < top || pixel > bottom).toBe(true);
      }
    });

    /** Returning a non-finite value makes `fillRect` a no-op — **every bar vanishes**. */
    it("should never return a non-finite pixel", () => {
      for (const value of [-1e308, 0, Number.EPSILON]) {
        expect(Number.isFinite(scale.scale(value))).toBe(true);
      }
    });
  });

  describe("invert", () => {
    it("should map a screen value back to a data value", () => {
      expect(scale.invert(400)).toBeCloseTo(10, 1);
    });

    it("should map range bounds back to domain bounds", () => {
      expect(scale.invert(0)).toBeCloseTo(1, 1);
      expect(scale.invert(800)).toBeCloseTo(100, 1);
    });
  });

  describe("validation", () => {
    it("should throw if domain is not positive", () => {
      expect(() => new LogScale(0, 100, 0, 800)).toThrow();
      expect(() => new LogScale(-10, 100, 0, 800)).toThrow();
      expect(() => new LogScale(1, -100, 0, 800)).toThrow();
    });
  });
});

describe("LogScale validation branches", () => {
  it("should throw when the domain is inverted", () => {
    expect(() => new LogScale(100, 10, 0, 800)).toThrow(/less than/);
  });

  it("should throw when domain min equals max", () => {
    expect(() => new LogScale(10, 10, 0, 800)).toThrow(/less than/);
  });

  it("should throw when range start equals end", () => {
    const scale = new LogScale(1, 100, 0, 800);

    expect(() => scale.setRange(400, 400)).toThrow(/must differ/);
  });

  it("should allow an inverted range for a downward y axis", () => {
    const scale = new LogScale(1, 100, 0, 800);
    scale.setRange(800, 0);

    expect(scale.scale(1)).toBe(800);
    expect(scale.scale(100)).toBe(0);
  });

  it("should default to a usable domain with no args", () => {
    const bare = new LogScale();

    expect(bare.getDomain()).toEqual([1, 10]);
    expect(bare.getRange()).toEqual([0, 1]);
  });

  it("should not expose internal arrays", () => {
    const scale = new LogScale(1, 100, 0, 800);
    const domain = scale.getDomain();
    domain[0] = 999;

    expect(scale.getDomain()).toEqual([1, 100]);
  });

  it("should reject a non-positive domain through setDomain", () => {
    const scale = new LogScale(1, 100, 0, 800);

    expect(() => scale.setDomain(0, 10)).toThrow(/positive/);
    expect(() => scale.setDomain(-5, 10)).toThrow(/positive/);
  });
});

describe("pixels stay finite at the edge of the doubles", () => {
  it("LinearScale: a domain whose span overflows still maps every finite value to a finite pixel, in order", () => {
    const max = Number.MAX_VALUE;
    const scale = new LinearScale(-max, max, 600, 0);
    expect(scale.scale(-max)).toBe(600);
    expect(scale.scale(0)).toBe(300);
    expect(scale.scale(max)).toBe(0);
    expect(scale.scale(max / 2)).toBeCloseTo(150);
    expect(scale.invert(300)).toBe(0);
    expect(scale.invert(0)).toBe(max);
    expect(scale.invert(600)).toBe(-max);
    // A value whose pixel itself lies past the doubles is still infinite — honestly: the halving only keeps a
    // finite answer finite.
    const narrow = new LinearScale(-1, 1, 600, 0);
    expect(narrow.scale(1e308)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("LinearScale: an ordinary domain's pixels are the same bits as the plain arithmetic", () => {
    const scale = new LinearScale(0.1, 0.7, 0, 800);
    for (const value of [0.1, 0.3, 0.45, 0.7, 1.3]) {
      expect(scale.scale(value)).toBe(0 + ((value - 0.1) / (0.7 - 0.1)) * 800);
    }
  });

  it("LogScale: two adjacent doubles make a domain whose logarithms are equal — the ends still land on the range", () => {
    const max = Number.MAX_VALUE;
    const prev = max - 2 ** 971;
    expect(Math.log(prev)).toBe(Math.log(max));
    const scale = new LogScale(prev, max, 600, 0);
    expect(scale.scale(prev)).toBe(600);
    expect(scale.scale(max)).toBe(0);
    expect(Number.isFinite(scale.scale(max / 2))).toBe(true);
    expect(scale.invert(600)).toBe(prev);
    expect(scale.invert(0)).toBe(max);
  });

  it("LogScale: a narrow domain keeps its digits — the middle of [1, 1 + 1e-12] is the middle of the range", () => {
    const scale = new LogScale(1, 1 + 1e-12, 0, 600);
    expect(scale.scale(1 + 5e-13)).toBeCloseTo(300, 3);
    expect(scale.scale(1)).toBe(0);
    expect(scale.scale(1 + 1e-12)).toBe(600);
    expect(scale.invert(300)).toBeCloseTo(1 + 5e-13, 15);
    // Monotone across the domain, sampled.
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const y = scale.scale(1 + (i / 100) * 1e-12);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });

  it("LogScale: near the top of the doubles a narrow domain's plain logarithms lose the pixel — the relative form keeps it", () => {
    const max = Number.MAX_VALUE;
    const min = max * (1 - 1e-8);
    const scale = new LogScale(min, max, 0, 600);
    const middle = min + (max - min) / 2;
    // Two logarithms of ~709.78 differ in their 14th digit here; subtracting them leaves a ratio off by ~1e-5,
    // a hundredth of a pixel at the middle — the relative form is exact to the double.
    expect(scale.scale(middle)).toBeCloseTo(300, 4);
    expect(scale.scale(min)).toBe(0);
    expect(scale.scale(max)).toBe(600);
  });

  it("LogScale: a value far from a narrow domain, or a narrow domain far down the doubles, still gets the plain logarithms' finite answer", () => {
    const plain = (min: number, max: number, value: number): number => ((Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 600;
    const narrow = new LogScale(1, 1.5, 0, 600);
    expect(narrow.scale(1e-20)).toBeCloseTo(plain(1, 1.5, 1e-20), 6);
    expect(narrow.scale(1e20)).toBeCloseTo(plain(1, 1.5, 1e20), 6);
    expect(narrow.invert(-60000)).toBeCloseTo(2.459654426579835e-18, 30);
    expect(narrow.invert(-60000)).toBeGreaterThan(0);
    const subnormal = new LogScale(1e-323, 1.5e-323, 0, 600);
    expect(Number.isFinite(subnormal.scale(1))).toBe(true);
    expect(subnormal.scale(1)).toBeGreaterThan(600);
    const tiny = new LogScale(1e-300, 1.5e-300, 0, 600);
    // (The plain logarithms' own answer is off in its eleventh digit here — the relative form is the sharper one.)
    expect(Math.abs(tiny.invert(2000 * 600) / 1.522362618560982e52 - 1)).toBeLessThan(1e-9);
    expect(Number.isFinite(tiny.invert(2000 * 600))).toBe(true);
  });

  it("LogScale: the adjacent-doubles domain also gets finite ticks, and a positive interval at the doubles' ends expands to a finite domain", () => {
    const max = Number.MAX_VALUE;
    const scale = new LogScale(max - 2 ** 971, max, 600, 0);
    const ticks = scale.tickGeometry(40).values();
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 0; i < ticks.length; i++) {
      expect(Number.isFinite(ticks[i])).toBe(true);
      expect(ticks[i]).toBeGreaterThanOrEqual(max - 2 ** 971);
      expect(ticks[i]).toBeLessThanOrEqual(max);
      if (i > 0) {
        expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
        expect(Math.abs(scale.scale(ticks[i]) - scale.scale(ticks[i - 1]))).toBeGreaterThanOrEqual(40 - 1e-9);
      }
    }
    // A domain of a few dozen ulps: two ticks agree to fifteen digits, so the rounding that cleans labels would
    // make them one — the ticks stay ascending and spaced all the same.
    const hairline = new LogScale(1, 1 + 1e-14, 0, 600);
    const fine = hairline.tickGeometry(40).values();
    expect(fine.length).toBeGreaterThan(1);
    for (let i = 1; i < fine.length; i++) {
      expect(fine[i]).toBeGreaterThan(fine[i - 1]);
      expect(Math.abs(hairline.scale(fine[i]) - hairline.scale(fine[i - 1]))).toBeGreaterThanOrEqual(40 - 1e-9);
    }
    // A collapsed extent at either end of the doubles still fits on a real plot: a lone point at ±MAX.
    for (const value of [max, -max]) {
      const model = createPlotModel({ size: { width: 800, height: 600 }, config: { showGrid: false } });
      expect(() => model.plot.mainPane.addSeries({ series: lineSeries(), data: [{ x: 0, y: value }] })).not.toThrow();
      expect(() => model.plot.render()).not.toThrow();
    }
    const [low, high] = new LogScale().expand([Number.MIN_VALUE, max], 0.05);
    expect(low).toBeGreaterThan(0);
    expect(Number.isFinite(high)).toBe(true);
    expect(high).toBe(max);
    // Six hundred decades apart the ends' ratio is past the doubles while the padding itself is ordinary:
    // half a percent of 600 decades is three decades each way.
    const [padLow, padHigh] = new LogScale().expand([1e-300, 1e300], 0.005);
    expect(Math.log10(padLow)).toBeCloseTo(-303, 6);
    expect(Math.log10(padHigh)).toBeCloseTo(303, 6);
  });

  it("a fit at the top of the doubles keeps its ends: padding that would leave them is not applied, and each end is padded on its own", () => {
    const max = Number.MAX_VALUE;
    const [lowAtMax, highAtMax] = expandRange({ min: max, max }, 0.1);
    expect(highAtMax).toBe(max);
    expect(lowAtMax).toBeLessThan(max);
    const [lowAtMin, highAtMin] = expandRange({ min: -max, max: -max }, 0.1);
    expect(lowAtMin).toBe(-max);
    expect(highAtMin).toBeGreaterThan(-max);
    // A collapsed value past 2⁵⁰, where ±1 would be absorbed, still gets two ends; below it, ±1 as ever.
    const [lowBig, highBig] = expandRange({ min: 1e20, max: 1e20 }, 0.1);
    expect(lowBig).toBeLessThan(1e20);
    expect(highBig).toBeGreaterThan(1e20);
    expect(expandRange({ min: 100, max: 100 }, 0.1)).toEqual([99, 101]);
    expect(expandRange({ min: 0, max }, 0.1)).toEqual([-max * 0.1, max]);
    expect(expandRange({ min: -max, max }, 0.1)).toEqual([-max, max]);
    // The ends' difference overflows while the upper end's own padding does not: it is padded, the lower kept.
    const [lowHalf, highHalf] = expandRange({ min: -max, max: max / 2 }, 0.1);
    expect(lowHalf).toBe(-max);
    expect(highHalf).toBeCloseTo(0.65 * max, -300);
    expect(highHalf).toBeGreaterThan(max / 2);
    expect(expandRange({ min: 0, max: 100 }, 0.1)).toEqual([-10, 110]);
    expect(expandRange({ min: 0.1, max: 0.7 }, 0.1)).toEqual([0.1 - (0.7 - 0.1) * 0.1, 0.7 + (0.7 - 0.1) * 0.1]);
    expect(new LogScale().expand([max, max], 0.1)).toEqual([max / 2, max]);
    expect(new LogScale().expand([1, 1], 0.1)).toEqual([0.5, 2]);
    // A log padding whose shared factor would overflow (a hundred decades times four): each end on its own.
    const [logLow, logHigh] = new LogScale().expand([1e-300, 1e-200], 4);
    expect(logLow).toBe(1e-300);
    expect(Math.log10(logHigh)).toBeCloseTo(200, 6);
    // Two adjacent doubles: their logarithms are equal, their ratio is not — the padding is real.
    const [adjLow, adjHigh] = new LogScale().expand([100, nextUp(100)], 4);
    expect(adjLow).toBeLessThan(100);
    expect(adjHigh).toBeGreaterThan(nextUp(100));
    // A subnormal linear range keeps its padding: the plain span is used wherever it is finite.
    const u = Number.MIN_VALUE;
    expect(expandRange({ min: u, max: 6 * u }, 0.1)).toEqual([0, 7 * u]);
  });

  it("LogScale: scale and invert are monotone across every form the arithmetic takes", { timeout: 30_000 }, () => {
    const max = Number.MAX_VALUE;
    const domains: [number, number][] = [[1e-300, 3e-300], [1e-100, 3e-100], [1, 1.5], [1, 1000], [max * (1 - 1e-8), max], [1e-320, 1e-310]];
    for (const [min, top] of domains) {
      const scale = new LogScale(min, top, 0, 600);
      let previous = Number.NEGATIVE_INFINITY;
      for (let i = 0; i <= 1200; i++) {
        // Geometrically from far below the domain to far above, kept positive and finite.
        const value = Math.min(max, min * 10 ** (-12 + (i / 1200) * (Math.log10(top / min) + 24)));
        if (!(value > 0) || !Number.isFinite(value)) continue;
        const y = scale.scale(value);
        expect(y).toBeGreaterThanOrEqual(previous);
        previous = y;
      }
      let previousValue = 0;
      for (let px = -60000; px <= 60600; px += 37) {
        const value = scale.invert(px);
        expect(value).toBeGreaterThanOrEqual(previousValue);
        previousValue = value;
      }
    }
    // The two spots a rounding once reversed: a value just under twice `min`, and the pixel of `min × e`.
    const tiny = new LogScale(1e-300, 3e-300, 0, 600);
    expect(tiny.scale(2e-300 - 2e-300 * Number.EPSILON)).toBeLessThanOrEqual(tiny.scale(2e-300));
    const hundred = new LogScale(1e-100, 3e-100, 0, 600);
    const atE = (600 * 1) / Math.log(3);
    expect(hundred.invert(atE - 1e-9)).toBeLessThanOrEqual(hundred.invert(atE + 1e-9));
  });

  it("LogScale: a subnormal minimum keeps its digits — the reconstruction divides by the product, not through a subnormal", () => {
    const scale = new LogScale(Number.MIN_VALUE, 1e-14, 0, 1);
    const plain = (Math.log(1e-14) - Math.log(Number.MIN_VALUE));
    expect(scale.scale(5e-15)).toBeCloseTo(1 - Math.log(2) / plain, 12);
    expect(scale.invert(1)).toBe(1e-14);
    // Just past the range's end the value keeps rising — no reversal at the bound.
    expect(scale.invert(1 + Number.EPSILON)).toBeGreaterThanOrEqual(1e-14);
    expect(scale.invert(1 + 1e-6)).toBeGreaterThan(1e-14);
  });

  it("LogScale: the whole positive range of the doubles, six hundred decades from the smallest subnormal to the largest double, is one axis", () => {
    const min = Number.MIN_VALUE;
    const max = Number.MAX_VALUE;
    const scale = new LogScale(min, max, 0, 1);
    const plain = Math.log(max) - Math.log(min);
    expect(scale.scale(min)).toBe(0);
    expect(scale.scale(max)).toBe(1);
    expect(scale.scale(1)).toBeCloseTo((0 - Math.log(min)) / plain, 12);
    expect(scale.scale(1e300)).toBeCloseTo((Math.log(1e300) - Math.log(min)) / plain, 12);
    expect(scale.invert(0)).toBe(min);
    expect(scale.invert(1)).toBe(max);
    expect(Math.abs(scale.invert(0.5) / Math.exp(Math.log(min) + 0.5 * plain) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(scale.invert(0.999) / Math.exp(Math.log(min) + 0.999 * plain) - 1)).toBeLessThan(1e-9);
    const ticks = scale.tickGeometry(40).values();
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(0);
      expect(Number.isFinite(ticks[i])).toBe(true);
      if (i > 0) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
    // And a fit over most of it still pads the top: a thousandth of six hundred decades is six tenths of one.
    const [, padded] = new LogScale().expand([min, 1e300], 0.001);
    expect(Math.log10(padded)).toBeCloseTo(300.6, 1);
    // Just inside the range of a subnormal-floored axis the inverse is the interior value, not the top end.
    const floor = new LogScale(min, 1e-14, 0, 1);
    const plainFloor = Math.log(1e-14) - Math.log(min);
    expect(Math.abs(floor.invert(0.997) / Math.exp(Math.log(min) + 0.997 * plainFloor) - 1)).toBeLessThan(1e-9);
    expect(floor.scale(floor.invert(0.997))).toBeCloseTo(0.997, 9);
  });

  it("LogScale: what is not a finite value gets no ratio and no loop — its logarithm answers; a pixel past the doubles inverts to infinity, not NaN", () => {
    const scale = new LogScale(1, 1000, 0, 600);
    expect(scale.scale(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(scale.scale(Number.NaN))).toBe(true);
    expect(scale.invert(1e200)).toBe(Number.POSITIVE_INFINITY);
    expect(scale.invert(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(scale.invert(Number.NaN))).toBe(true);
    // The bottom of the doubles: a domain of ten smallest subnormals plans finite ticks — the smallest double
    // is the decade there, not zero.
    const bottom = new LogScale(Number.MIN_VALUE, 10 * Number.MIN_VALUE, 0, 600);
    const ticks = bottom.tickGeometry(40).values();
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(0);
      expect(Number.isFinite(ticks[i])).toBe(true);
      if (i > 0) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });

  it("an extrapolation whose product leaves the doubles before its sum comes back is still the finite answer", () => {
    const max = Number.MAX_VALUE;
    // 2 × (0 − MAX) is past the doubles; MAX + that is −MAX, inside them.
    expect(new LinearScale(0, 1, max, 0).scale(2)).toBe(-max);
    expect(new LinearScale(-max, 0, 0, 1).invert(2)).toBe(max);
    expect(new LogScale(1, 2, max, 0).scale(4)).toBe(-max);
    // And one whose answer itself is past the doubles is infinite, honestly.
    expect(new LinearScale(0, 1, max, 0).scale(3)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("a range of ±MAX_VALUE pixels is as legal as such a domain: the ends still map to the ends, on both axes", () => {
    const max = Number.MAX_VALUE;
    for (const scale of [new LinearScale(1, 100, -max, max), new LogScale(1, 100, -max, max)]) {
      expect(scale.scale(1)).toBe(-max);
      expect(scale.scale(100)).toBe(max);
      expect(Number.isFinite(scale.scale(10))).toBe(true);
      expect(scale.invert(-max)).toBe(1);
      expect(scale.invert(max)).toBe(100);
      expect(scale.invert(0)).toBeGreaterThan(1);
      expect(scale.invert(0)).toBeLessThan(100);
    }
  });

  it("LogScale: on a range of ±MAX_VALUE pixels a value at or below zero still gets a finite pixel past the near end, and ladder rungs keep their pixel gap", () => {
    const max = Number.MAX_VALUE;
    const up = new LogScale(1, 100, -max, max);
    expect(Number.isFinite(up.scale(0))).toBe(true);
    expect(up.scale(0)).toBeLessThanOrEqual(up.scale(1));
    expect(up.scale(-1)).toBe(up.scale(0));
    const down = new LogScale(1, 100, max, -max);
    expect(Number.isFinite(down.scale(0))).toBe(true);
    expect(down.scale(0)).toBeGreaterThanOrEqual(down.scale(1));
    // Ten smallest subnormals over a range of two adjacent doubles: the ladder's rungs all but one land on
    // the same pixel — a tick is a place, and two ticks under the requested gap apart are one.
    const crushed = new LogScale(Number.MIN_VALUE, 10 * Number.MIN_VALUE, max - 2 ** 971, max);
    const ticks = crushed.tickGeometry(40).values();
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
      expect(Math.abs(crushed.scale(ticks[i]) - crushed.scale(ticks[i - 1]))).toBeGreaterThanOrEqual(40);
    }
  });

  it("LogScale: the ticks that are emitted keep the requested gap — after their labels' rounding, at any spacing, and at the bottom of the doubles", { timeout: 30_000 }, () => {
    const contract = (scale: LogScale, spacing: number, min: number, max: number): number[] => {
      const ticks = scale.tickGeometry(spacing).values();
      // Every domain here holds two places and every range is at least a gap tall: there is always a tick.
      expect(ticks.length).toBeGreaterThan(0);
      for (let i = 0; i < ticks.length; i++) {
        expect(Number.isFinite(ticks[i])).toBe(true);
        expect(ticks[i]).toBeGreaterThanOrEqual(min);
        expect(ticks[i]).toBeLessThanOrEqual(max);
        if (i > 0) {
          expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
          expect(Math.abs(scale.scale(ticks[i]) - scale.scale(ticks[i - 1]))).toBeGreaterThanOrEqual(spacing * (1 - 2 ** -40));
        }
      }
      return ticks;
    };
    // A label's fifteen-digit rounding moved a tick under the gap the plan had checked.
    contract(new LogScale(8.06798900190339e-303, 8.068010726842184e-303, 600, 0), 5.098776948820927e-7, 8.06798900190339e-303, 8.068010726842184e-303);
    // A spacing of a billionth of a pixel: two rungs on one pixel are still one tick.
    const max = Number.MAX_VALUE;
    contract(new LogScale(Number.MIN_VALUE, 10 * Number.MIN_VALUE, max - 2 ** 971, max), 1e-9, Number.MIN_VALUE, 10 * Number.MIN_VALUE);
    // Two adjacent doubles over a range two largest-doubles tall: the height holds "infinitely many" ticks, the
    // domain two places — at least one tick, inside the domain.
    contract(new LogScale(3, 3.0000000000000004, -max, max), 40, 3, 3.0000000000000004);
    // Two adjacent doubles whose nice step has no multiple between them, under a range exactly one gap tall:
    // the domain's own end is the tick — across the exponents.
    for (const exponent of [-298, -200, -100, -50, -10, -1, 0, 3, 10, 50, 100, 200, 300]) {
      const lo = 1.1 * 10 ** exponent;
      const hi = nextUp(lo);
      contract(new LogScale(lo, hi, 0, Number.MIN_VALUE), Number.MIN_VALUE, lo, hi);
      contract(new LogScale(lo, hi, 0, 40), 40, lo, hi);
    }
    // The two smallest subnormals as a domain: two places, two ticks.
    const twoPlaces = contract(new LogScale(Number.MIN_VALUE, 2 * Number.MIN_VALUE, 0, 600), 40, Number.MIN_VALUE, 2 * Number.MIN_VALUE);
    expect(twoPlaces).toEqual([Number.MIN_VALUE, 2 * Number.MIN_VALUE]);
    // A deterministic sweep of narrow domains at odd spacings.
    let seed = 7;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 40; i++) {
      const exponent = -300 + Math.floor(next() * 600);
      const min = (1 + next()) * 10 ** exponent;
      const width = min * 10 ** (-14 + next() * 14);
      const spacing = 10 ** (-7 + next() * 9);
      contract(new LogScale(min, min + width, 600, 0), spacing, min, min + width);
    }
  });

  it("LogScale: a pixel far below the range inverts to the small value it names, not to zero; a NaN extent pads to NaN, not forever", () => {
    const scale = new LogScale(1e300, 1e301, 0, 1);
    const plain = Math.exp(Math.log(1e300) - 400 * (Math.log(1e301) - Math.log(1e300)));
    expect(scale.invert(-400)).toBeGreaterThan(0);
    expect(Math.abs(scale.invert(-400) / plain - 1)).toBeLessThan(1e-9);
    // Far enough down, the answer is below the doubles: zero, honestly.
    expect(scale.invert(-1e6)).toBe(0);
    const [low, high] = new LogScale().expand([Number.NaN, 100], 0.1);
    expect(Number.isNaN(low) || Number.isNaN(high)).toBe(true);
  });

  it("LogScale: a tick never leaves the domain — not by a first multiple that underflowed, nor by a label's rounding", () => {
    const wide = new LogScale(4e-231, 2.6e230, 0, 40);
    for (const tick of wide.tickGeometry(20).values()) {
      expect(tick).toBeGreaterThanOrEqual(4e-231);
      expect(tick).toBeLessThanOrEqual(2.6e230);
    }
    // Adjacent doubles just above 1: every tick's fifteen-digit label is "1", below the domain — the exact
    // values are kept as the ticks.
    const nearOne = new LogScale(1 + 2 * Number.EPSILON, 1 + 4 * Number.EPSILON, 0, 20);
    const fine = nearOne.tickGeometry(1).values();
    expect(fine.length).toBeGreaterThan(0);
    for (const tick of fine) {
      expect(tick).toBeGreaterThanOrEqual(1 + 2 * Number.EPSILON);
      expect(tick).toBeLessThanOrEqual(1 + 4 * Number.EPSILON);
    }
    const twins = new LogScale(1.7976931348623155e308, 1.7976931348623157e308, 0, 20);
    const ticks = twins.tickGeometry(1).values();
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(1.7976931348623155e308);
      expect(tick).toBeLessThanOrEqual(1.7976931348623157e308);
    }
  });

  it("LogScale: ticks on a short axis over the whole positive range stay finite — the nice step stops at the last decade", () => {
    const max = Number.MAX_VALUE;
    const scale = new LogScale(1, max, 0, 20);
    const ticks = scale.tickGeometry(40).values();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(1000);
    for (let i = 0; i < ticks.length; i++) {
      expect(Number.isFinite(ticks[i])).toBe(true);
      expect(ticks[i]).toBeGreaterThanOrEqual(1);
      expect(ticks[i]).toBeLessThanOrEqual(max);
      if (i > 0) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
    // Two adjacent doubles as a domain plan their ticks from a real decade count, not a cancelled zero.
    const twin = new LogScale(100, 100 + 100 * Number.EPSILON, 0, 600);
    for (const tick of twin.tickGeometry(40).values()) expect(Number.isFinite(tick)).toBe(true);
  });

  it("LogScale: a wide domain's pixels are the same bits as the plain logarithms", () => {
    const scale = new LogScale(1, 1000, 0, 600);
    for (const value of [1, 10, 250, 1000, 5000]) {
      expect(scale.scale(value)).toBe(0 + ((Math.log(value) - Math.log(1)) / (Math.log(1000) - Math.log(1))) * 600);
    }
  });
});
