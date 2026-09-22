import { beforeEach, describe, expect, it } from "vitest";
import { LinearScale } from "../../scale";
import { Axis } from "../axis";

describe("Axis", () => {
  let scale: LinearScale;

  beforeEach(() => {
    // data: 0-100, screen: 0-800
    scale = new LinearScale(0, 100, 0, 800);
  });

  describe("horizontal axis", () => {
    it("should create ticks with correct positions", () => {
      const axis = new Axis(scale, "horizontal", {
        tickInterval: 10,
      });

      const ticks = axis.getTicks();

      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks[0].value).toBe(0);
      expect(ticks[0].position).toBe(0);
    });

    it("should format tick labels", () => {
      const axis = new Axis(scale, "horizontal", {
        tickInterval: 50,
        format: (v) => `${v}%`,
      });

      expect(axis.getTicks()[0].label).toBe("0%");
    });

    it("should hand the tick interval to the formatter — material for the format to distinguish neighbors", () => {
      const steps: Array<number | undefined> = [];
      new Axis(scale, "horizontal", {
        tickInterval: 50,
        format: (v, step) => {
          steps.push(step);
          return String(v);
        },
      });

      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => step === 50)).toBe(true);
    });

  });

  describe("vertical axis", () => {
    it("should follow the scale's inverted range instead of flipping again", () => {
      // The y-axis scale is inverted to [bottom, top].
      scale.setRange(800, 0);

      const axis = new Axis(scale, "vertical", {
        tickInterval: 20,
      });

      const ticks = axis.getTicks();

      expect(ticks.length).toBeGreaterThan(0);
      // vertical axis: a larger value must have a smaller position
      for (let i = 0; i < ticks.length - 1; i++) {
        expect(ticks[i].position).toBeGreaterThan(ticks[i + 1].position);
      }
    });
  });

  describe("auto tick interval", () => {
    it("should calculate auto tick interval when not specified", () => {
      const axis = new Axis(scale, "horizontal", {
      });

      const ticks = axis.getTicks();

      // auto mode should generate a reasonable number of ticks (usually 5-10)
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(15);
    });
  });

  describe("tick density follows the available pixels", () => {
    /** Checks whether the value spacing is uniform. */
    function intervalOf(axis: Axis): number {
      const ticks = axis.getTicks();
      return ticks[1].value - ticks[0].value;
    }

    function autoAxis(
      domain: [number, number],
      range: [number, number],
      orientation: "horizontal" | "vertical" = "horizontal",
    ): Axis {
      const s = new LinearScale(domain[0], domain[1], range[0], range[1]);
      return new Axis(s, orientation, {
      });
    }

    it("should thin out the ticks when the axis is short", () => {
      const wide = autoAxis([0, 100], [0, 800]).getTicks();
      const narrow = autoAxis([0, 100], [0, 200]).getTicks();

      expect(narrow.length).toBeLessThan(wide.length);
    });

    it("should keep every tick label above the minimum spacing", () => {
      const ticks = autoAxis([0, 100], [0, 200]).getTicks();

      for (let i = 0; i < ticks.length - 1; i++) {
        const gap = Math.abs(ticks[i + 1].position - ticks[i].position);
        expect(gap).toBeGreaterThanOrEqual(80);
      }
    });

    it("should not swing wildly when the domain barely changes", () => {
      // A regression where shrinking the width by just 2% (50 → 49) made
      // the count jump from 6 to 50.
      const fifty = autoAxis([0, 50], [0, 800]).getTicks();
      const fortyNine = autoAxis([0, 49], [0, 800]).getTicks();

      expect(Math.abs(fifty.length - fortyNine.length)).toBeLessThanOrEqual(2);
    });

    it("should pack a vertical axis tighter than a horizontal one", () => {
      // A vertical axis label is a single line, so it stays readable
      // even packed tighter than a horizontal one.
      const horizontal = autoAxis([0, 100], [0, 400], "horizontal").getTicks();
      const vertical = autoAxis([0, 100], [400, 0], "vertical").getTicks();

      expect(vertical.length).toBeGreaterThan(horizontal.length);
    });

    it("should only ever pick 1, 2 or 5 times a power of ten", () => {
      for (const max of [3, 7, 49, 50, 137, 900, 4321]) {
        const interval = intervalOf(autoAxis([0, max], [0, 800]));
        const normalized = interval / 10 ** Math.floor(Math.log10(interval));

        expect([1, 2, 5]).toContain(Math.round(normalized));
      }
    });
  });

  describe("tick values", () => {
    it("should snap to multiples of the interval, not to the domain edge", () => {
      // The value domain gets 10% of padding, so it starts at a value
      // like 97.3. If the ticks also started at 97.3, the labels would
      // be unreadable.
      const s = new LinearScale(97.3, 121.6, 400, 0);
      const axis = new Axis(s, "vertical", {
      });

      const ticks = axis.getTicks();
      const interval = ticks[1].value - ticks[0].value;

      expect(ticks.length).toBeGreaterThan(1);
      for (const tick of ticks) {
        expect(tick.value % interval).toBeCloseTo(0, 10);
      }
    });

    it("should stay inside the domain", () => {
      const s = new LinearScale(97.3, 121.6, 400, 0);
      const ticks = new Axis(s, "vertical", {
      }).getTicks();

      expect(ticks[0].value).toBeGreaterThanOrEqual(97.3);
      expect(ticks[ticks.length - 1].value).toBeLessThanOrEqual(121.6);
    });

    it("should not carry floating point noise into labels", () => {
      const s = new LinearScale(0, 1, 400, 0);
      const axis = new Axis(s, "vertical", {
      });

      // Accumulating by 0.05 each step produces 0.30000000000000004.
      const values = axis.getTicks().map((tick) => tick.value);
      const near = values.find((v) => Math.abs(v - 0.3) < 1e-9);

      expect(near).toBe(0.3);
    });

    it("should survive min and max collapsing to a point", () => {
      // The scale enforces min < max, but doesn't stop a config override
      // from breaking that.
      const axis = new Axis(scale, "horizontal", {
        min: 5,
        max: 5,
      });

      expect(axis.getTicks().length).toBeLessThanOrEqual(1);
    });
  });

  describe("scale domain", () => {
    it("should derive default min/max from the scale domain", () => {
      scale.setDomain(10, 60);

      const axis = new Axis(scale, "horizontal", {
        tickInterval: 10,
      });

      const ticks = axis.getTicks();

      expect(ticks[0].value).toBe(10);
      expect(ticks[ticks.length - 1].value).toBe(60);
    });

    it("should respect custom min/max", () => {
      const axis = new Axis(scale, "horizontal", {
        min: 20,
        max: 80,
        tickInterval: 10,
      });

      const ticks = axis.getTicks();

      expect(ticks[0].value).toBe(20);
      expect(ticks[ticks.length - 1].value).toBe(80);
    });
  });
});

it.each([[1, 1 + 1e-14], [-Number.MAX_VALUE, Number.MAX_VALUE]])("keeps finite distinct ticks across [%s,%s]", (min, max) => {
  const ticks = new Axis(new LinearScale(min, max, 0, 1000), "horizontal", {}).getTicks();
  expect(ticks.length).toBeGreaterThan(2);
  expect(ticks.length).toBeLessThan(1000);
  expect(ticks.every(t => Number.isFinite(t.value) && t.value >= min && t.value <= max)).toBe(true);
  expect(ticks.every((t, i) => i === 0 || t.value > ticks[i - 1].value)).toBe(true);
  expect(ticks.every((t, i) => i === 0 || t.position > ticks[i - 1].position)).toBe(true);
});

it("does not lose a positive tick interval to subnormal underflow", () => {
  const min = Number.MIN_VALUE;
  const ticks = new Axis(new LinearScale(min, min * 2, 0, 1000), "horizontal", {}).getTicks();
  expect(ticks.map(t => t.value)).toEqual([min, min * 2]);
  expect(ticks.map(t => t.position)).toEqual([0, 1000]);
});
