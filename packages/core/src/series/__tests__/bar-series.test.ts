import { describe, expect, it } from "vitest";
import type { OHLC } from "../../data";
import { createPlotModel } from "../../plot";
import type { Point } from "../../primitives";
import type { LineStyle } from "../../render";
import { barSeries, DEFAULT_BAR_STYLE } from "../bar-series";

const bars: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 1, open: 105, high: 112, low: 101, close: 102 },
];

interface Line {
  points: readonly Point[];
  style: LineStyle;
}

function drawnLines(): Line[] {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: barSeries(), data: bars },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });

  const lines: Line[] = [];
  for (const command of model.commands()) {
    if (command.type === "drawLine") lines.push(command);
  }
  model.plot.destroy();
  return lines;
}

/**
 * The screen y of `value`, read off the spine's own high and low ends. The
 * y-scale is linear, so this needs no access to the plot's scale.
 */
function yOnSpine(spine: Line, bar: OHLC, value: number): number {
  const [high, low] = spine.points;
  return low.y + ((value - bar.low) / (bar.high - bar.low)) * (high.y - low.y);
}

describe("barSeries", () => {
  it("should draw a spine, a left open tick and a right close tick per bar", () => {
    const lines = drawnLines();
    expect(lines).toHaveLength(bars.length * 3);

    bars.forEach((bar, i) => {
      const [spine, open, close] = lines.slice(i * 3, i * 3 + 3);
      const x = spine.points[0].x;
      expect(spine.points[1].x).toBe(x);

      // Open hangs off the left side, close off the right.
      expect(open.points[0].x).toBeLessThan(x);
      expect(open.points[1].x).toBe(x);
      expect(close.points[0].x).toBe(x);
      expect(close.points[1].x).toBeGreaterThan(x);

      // Each tick sits flat at its own price.
      for (const p of open.points) expect(p.y).toBeCloseTo(yOnSpine(spine, bar, bar.open));
      for (const p of close.points) expect(p.y).toBeCloseTo(yOnSpine(spine, bar, bar.close));
    });
  });

  it("should color every stroke of a rising bar up and of a falling bar down", () => {
    const colors = drawnLines().map((line) => line.style.color);
    const { up, down } = DEFAULT_BAR_STYLE;
    // Bar 0 closes above its open, bar 1 below.
    expect(colors).toEqual([up, up, up, down, down, down]);
  });

  it("should claim low~high like the candle", () => {
    expect(barSeries().valueExtent(bars)).toEqual({ min: 95, max: 112 });
  });
});
