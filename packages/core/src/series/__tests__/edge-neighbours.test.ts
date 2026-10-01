/**
 * The slice handed to drawing used to stop at the last point inside the
 * view, so the segment to the off-screen neighbour was never drawn: a
 * zoomed-in line left an empty strip at both plot edges, a single visible
 * point drew no line at all, and a candle cut by the edge vanished.
 * Drawing now gets one neighbour on each side; the y range still comes
 * from the points inside the view.
 */
import { describe, expect, it } from "vitest";
import type { DataView, LineDataPoint, Range } from "../../data";
import { createPlotModel } from "../../plot/model";
import type { Series } from "../types";
import { lineSeries } from "..";

const config = {
  showGrid: false,
  axis: { x: { showLabels: false }, y: { showLabels: false } },
};

function linesOf(model: ReturnType<typeof createPlotModel>) {
  return model.commands().flatMap((command) => (command.type === "drawLine" ? [command.points] : []));
}

describe("drawing reaches the off-screen neighbour on each side", () => {
  it("draws the segments of a single visible point out to both plot edges", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: [
          { x: 0, y: 10 },
          { x: 50, y: 20 },
          { x: 100, y: 15 },
        ],
      },
      config,
    });
    model.plot.setVisibleRange(20, 80);
    model.plot.render();

    const lines = linesOf(model);
    expect(lines).toHaveLength(1);
    const xs = lines[0].map((point) => point.x);
    const area = model.plot.mainPane.area;
    expect(Math.min(...xs)).toBeLessThan(area.left);
    expect(Math.max(...xs)).toBeGreaterThan(area.right);
  });

  it("hands drawing the neighbours but keeps them out of the y range", () => {
    const drawn: number[][] = [];
    const extents: number[][] = [];
    const spy: Series<LineDataPoint> = {
      valueExtent(data: DataView<LineDataPoint>): Range | null {
        extents.push(data.map((point) => point.x));
        return { min: 0, max: 1 };
      },
      draw(_target, context) {
        drawn.push(context.data.map((point) => point.x));
      },
    };
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: spy,
        data: [0, 10, 20, 30, 40, 50].map((x) => ({ x, y: x })),
      },
      config,
    });
    model.plot.setVisibleRange(15, 35);
    drawn.length = 0;
    extents.length = 0;
    model.plot.render();

    expect(drawn.at(-1)).toEqual([10, 20, 30, 40]);
    expect(extents.at(-1)).toEqual([20, 30]);
  });

  it("draws the segment across a view that holds no point", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: [
          { x: 0, y: 10 },
          { x: 100, y: 20 },
        ],
      },
      config,
    });
    model.plot.setVisibleRange(40, 60);
    model.plot.render();

    expect(linesOf(model)).toHaveLength(1);
  });
});
