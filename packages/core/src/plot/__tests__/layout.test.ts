import { describe, expect, it } from "vitest";
import { distributeHeights, sliceAreas } from "../layout";

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe("distributeHeights", () => {
  it("should give a lone pane everything", () => {
    expect(distributeHeights([{ flex: 1, minHeight: 0 }], 600, 4)).toEqual([
      600,
    ]);
  });

  it("should split by flex ratio", () => {
    const heights = distributeHeights(
      [
        { flex: 3, minHeight: 0 },
        { flex: 1, minHeight: 0 },
      ],
      400,
      0,
    );

    expect(heights).toEqual([300, 100]);
  });

  it("should take the gaps out of the available height", () => {
    const heights = distributeHeights(
      [
        { flex: 1, minHeight: 0 },
        { flex: 1, minHeight: 0 },
        { flex: 1, minHeight: 0 },
      ],
      320,
      10,
    );

    // 300 left, split three ways (gap 10 x 2)
    expect(heights).toEqual([100, 100, 100]);
    expect(sum(heights)).toBe(300);
  });

  it("should hold a starved pane at its minimum", () => {
    const heights = distributeHeights(
      [
        { flex: 20, minHeight: 0 },
        { flex: 1, minHeight: 80 },
      ],
      400,
      0,
    );

    expect(heights[1]).toBe(80);
  });

  it("should hand the leftover to the panes still above their minimum", () => {
    const heights = distributeHeights(
      [
        { flex: 3, minHeight: 0 },
        { flex: 1, minHeight: 0 },
        { flex: 1, minHeight: 100 },
      ],
      400,
      0,
    );

    expect(heights[2]).toBe(100);
    // The remaining 300 split 3:1
    expect(heights[0]).toBeCloseTo(225);
    expect(heights[1]).toBeCloseTo(75);
    expect(sum(heights)).toBeCloseTo(400);
  });

  it("should shrink everyone proportionally when the minimums do not fit", () => {
    const heights = distributeHeights(
      [
        { flex: 1, minHeight: 100 },
        { flex: 1, minHeight: 300 },
      ],
      200,
      0,
    );

    // 400 is needed but only 200 is available — each gets half.
    expect(heights).toEqual([50, 150]);
    expect(sum(heights)).toBe(200);
  });

  it("should never hand out more than the available height", () => {
    for (const available of [0, 5, 50, 137, 600]) {
      const heights = distributeHeights(
        [
          { flex: 1, minHeight: 40 },
          { flex: 2, minHeight: 40 },
          { flex: 1, minHeight: 40 },
        ],
        available,
        6,
      );

      expect(sum(heights)).toBeLessThanOrEqual(Math.max(0, available));
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(0);
    }
  });

  it("should split evenly when no pane declares flex", () => {
    const heights = distributeHeights(
      [
        { flex: 0, minHeight: 0 },
        { flex: 0, minHeight: 0 },
      ],
      300,
      0,
    );

    expect(heights).toEqual([150, 150]);
  });

  it("should return nothing for no panes", () => {
    expect(distributeHeights([], 600, 4)).toEqual([]);
  });
});

describe("sliceAreas", () => {
  const full = { left: 20, right: 780, top: 20, bottom: 580 };

  it("should stack the slices without overlapping", () => {
    const areas = sliceAreas(full, [300, 200], 10);

    expect(areas[0]).toEqual({ left: 20, right: 780, top: 20, bottom: 320 });
    expect(areas[1]).toEqual({ left: 20, right: 780, top: 330, bottom: 530 });
    expect(areas[1].top).toBeGreaterThan(areas[0].bottom);
  });

  it("should keep the horizontal extent shared", () => {
    for (const area of sliceAreas(full, [100, 100, 100], 4)) {
      expect(area.left).toBe(full.left);
      expect(area.right).toBe(full.right);
    }
  });

  it("should place a single slice at the top of the area", () => {
    expect(sliceAreas(full, [560], 10)).toEqual([full]);
  });
});

describe("finite layout weights", () => {
  it("preserves ratios when finite layout weights or floors overflow their sum", () => {
    expect(distributeHeights([{ flex: 1e308, minHeight: 0 }, { flex: 1e308, minHeight: 0 }], 100, 0)).toEqual([50, 50]);
    expect(distributeHeights([{ flex: 1, minHeight: 1e308 }, { flex: 1, minHeight: 1e308 }], 100, 0)).toEqual([50, 50]);
    expect(distributeHeights([{ flex: 1e308, minHeight: 60 }, { flex: 1e308, minHeight: 0 }], 100, 0)).toEqual([60, 40]);
  });
});
