import { describe, expect, it } from "vitest";
import type { PlotArea, Point } from "../../primitives";
import type { LineStyle } from "../../render";
import { drawGrid, type GridTarget } from "../grid";

const style: LineStyle = { width: 0.5, color: "#eee", dashArray: "5,5" };
// Every edge differs so a swapped edge cannot pass unnoticed.
const area: PlotArea = { left: 20, right: 780, top: 35, bottom: 580 };

function recordingTarget() {
  const lines: { points: Point[]; style: LineStyle }[] = [];
  const target: GridTarget = {
    drawLine: (points, lineStyle) => lines.push({ points, style: lineStyle }),
  };
  return { target, lines };
}

const verticals = [100, 300, 500];
const horizontals = [80, 400];

describe("drawGrid", () => {
  it("should draw one line per given position, verticals then horizontals", () => {
    const { target, lines } = recordingTarget();

    drawGrid(target, { verticals, horizontals, area, style });

    expect(lines.map(({ points }) => points)).toEqual([
      [{ x: 100, y: 35 }, { x: 100, y: 580 }],
      [{ x: 300, y: 35 }, { x: 300, y: 580 }],
      [{ x: 500, y: 35 }, { x: 500, y: 580 }],
      [{ x: 20, y: 80 }, { x: 780, y: 80 }],
      [{ x: 20, y: 400 }, { x: 780, y: 400 }],
    ]);
  });

  it("should span the full plot area", () => {
    const { target, lines } = recordingTarget();

    drawGrid(target, { verticals, horizontals, area, style });

    for (const { points } of lines) {
      const isVertical = points[0].x === points[1].x;
      if (isVertical) {
        expect(points.map((p) => p.y)).toEqual([area.top, area.bottom]);
      } else {
        expect(points.map((p) => p.x)).toEqual([area.left, area.right]);
      }
    }
  });

  it("should pass the given style through untouched", () => {
    const { target, lines } = recordingTarget();

    drawGrid(target, { verticals, horizontals, area, style });

    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line.style).toBe(style);
    }
  });
});
