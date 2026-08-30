import { beforeEach, describe, expect, it } from "vitest";
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
