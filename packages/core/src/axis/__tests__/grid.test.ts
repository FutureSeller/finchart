import { describe, expect, it } from "vitest";
import type { PlotArea, Point } from "../../primitives";
import type { LineStyle } from "../../render";
import { LinearScale } from "../../scale";
import { Axis } from "../axis";
import { drawGrid, type GridTarget } from "../grid";

const style: LineStyle = { width: 0.5, color: "#eee", dashArray: "5,5" };
const area: PlotArea = { left: 20, right: 780, top: 20, bottom: 580 };

function recordingTarget() {
  const lines: { points: Point[]; style: LineStyle }[] = [];
  const target: GridTarget = {
    drawLine: (points, lineStyle) => lines.push({ points, style: lineStyle }),
  };
  return { target, lines };
}

const axisConfig = {};

function ticksOf(scale: LinearScale, orientation: "horizontal" | "vertical") {
  return new Axis(scale, orientation, axisConfig)
    .getTicks()
    .map((tick) => tick.position);
}

function scales() {
  const xScale = new LinearScale(0, 100, area.left, area.right);
  const yScale = new LinearScale(0, 50, area.bottom, area.top);
  return { xScale, yScale };
}

describe("drawGrid", () => {
  it("should draw verticals at the x axis ticks", () => {
    const { target, lines } = recordingTarget();
    const { xScale, yScale } = scales();

    drawGrid(target, {
      verticals: ticksOf(xScale, "horizontal"),
      horizontals: ticksOf(yScale, "vertical"),
      area,
      style,
    });

    const verticals = lines
      .filter(({ points }) => points[0].x === points[1].x)
      .map(({ points }) => points[0].x);
    const ticks = new Axis(xScale, "horizontal", axisConfig).getTicks();

    expect(verticals).toEqual(ticks.map((t) => t.position));
  });

  it("should draw horizontals at the y axis ticks", () => {
    const { target, lines } = recordingTarget();
    const { xScale, yScale } = scales();

    drawGrid(target, {
      verticals: ticksOf(xScale, "horizontal"),
      horizontals: ticksOf(yScale, "vertical"),
      area,
      style,
    });

    const horizontals = lines
      .filter(({ points }) => points[0].y === points[1].y)
      .map(({ points }) => points[0].y);
    const ticks = new Axis(yScale, "vertical", axisConfig).getTicks();

    expect(horizontals).toEqual(ticks.map((t) => t.position));
  });

  it("should span the full plot area", () => {
    const { target, lines } = recordingTarget();
    const { xScale, yScale } = scales();

    drawGrid(target, {
      verticals: ticksOf(xScale, "horizontal"),
      horizontals: ticksOf(yScale, "vertical"),
      area,
      style,
    });

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
    const { xScale, yScale } = scales();

    drawGrid(target, {
      verticals: ticksOf(xScale, "horizontal"),
      horizontals: ticksOf(yScale, "vertical"),
      area,
      style,
    });

    for (const line of lines) {
      expect(line.style).toBe(style);
    }
  });

  it("should follow the domain rather than a fixed line count", () => {
    const counts = new Set<number>();

    for (const max of [10, 3000]) {
      const { target, lines } = recordingTarget();
      const xScale = new LinearScale(0, max, area.left, area.right);
      const yScale = new LinearScale(0, 50, area.bottom, area.top);

      drawGrid(target, {
      verticals: ticksOf(xScale, "horizontal"),
      horizontals: ticksOf(yScale, "vertical"),
      area,
      style,
    });
      counts.add(lines.filter(({ points }) => points[0].x === points[1].x).length);
    }

    expect(counts.size).toBeGreaterThan(1);
  });
});
