/**
 * Verifies that the root README's "30-second proof" example actually
 * passes.
 *
 * `showGrid` defaults to `true`, and the grid also emits as `drawLine` —
 * even with 5 data points, if grid lines get mixed in, `.find()` picks up a
 * 2-point grid line instead of the series, and the assertion breaks. That's
 * why `showGrid: false` has to be in the example. A `.types.ts` that only
 * checks types isn't enough — this assertion has to actually pass.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../data";
import { createPlotModel } from "../plot";
import { lineSeries } from "../series";

describe("README 30-second proof", () => {
  it("should hold exactly as written", () => {
    const size = { width: 800, height: 600 };
    const data: LineDataPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 15 },
      { x: 3, y: 25 },
      { x: 4, y: 18 },
    ];

    // --- from here on, this must not differ from the README by a single character ---
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    const lines = model.commands().filter((c) => c.type === "drawLine");
    expect(lines[0].points).toHaveLength(data.length);
    // --- end ---
  });

  /** Nails down why the grid can't be left on — `showGrid: false` is not fluff. */
  it("should show why the grid has to be off", () => {
    const data: LineDataPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 15 },
    ];
    const withGrid = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
    });

    const lines = withGrid.commands().filter((c) => c.type === "drawLine");

    // The grid line comes before the series — this is what find() picks up.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].points).not.toHaveLength(data.length);
  });
});
