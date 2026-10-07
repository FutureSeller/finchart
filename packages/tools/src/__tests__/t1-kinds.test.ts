import type { LineDataPoint, Point } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { gripAt, infiniteEndpoints } from "../hit";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";
import { drawingTools } from "../tools";

/**
 * T1 wave — ray · extended · arrow · vertical. Placement, hit, render,
 * drag, and the new "x" snap axis, per kind. The kind table
 * (kind-spec.test.ts) already pins serialization; this file pins the
 * other eight of the nine per-kind touch points.
 */

const space: DrawingSpace = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

const two = (type: "ray" | "extended" | "arrow"): Drawing => ({
  type,
  id: type,
  a: { x: 20, price: 20 },
  b: { x: 40, price: 40 },
});

describe("hit vocabulary", () => {
  it("vertical: the whole line is grabbable along its x", () => {
    const vertical: Drawing = { type: "vertical", id: "v", x: 30 };
    expect(gripAt([vertical], space, { x: 32, y: 80 })).toMatchObject({
      part: "whole",
    });
    expect(gripAt([vertical], space, { x: 40, y: 80 })).toBeNull();
  });

  it("ray: hits past b, never past a", () => {
    const ray = two("ray");
    // On the line beyond b (t > 1) — a ray keeps going.
    expect(gripAt([ray], space, { x: 60, y: 60 })).toMatchObject({
      part: "whole",
    });
    // On the line before a (t < 0) — a ray does not.
    expect(gripAt([ray], space, { x: 5, y: 5 })).toBeNull();
  });

  it("extended: hits on both sides", () => {
    const extended = two("extended");
    expect(gripAt([extended], space, { x: 60, y: 60 })).toMatchObject({
      part: "whole",
    });
    expect(gripAt([extended], space, { x: 5, y: 5 })).toMatchObject({
      part: "whole",
    });
  });

  it("arrow: the segment is the hit target — not the overshoot", () => {
    const arrow = two("arrow");
    expect(gripAt([arrow], space, { x: 30, y: 30 })).toMatchObject({
      part: "whole",
    });
    expect(gripAt([arrow], space, { x: 60, y: 60 })).toBeNull();
    // Endpoints still win.
    expect(gripAt([arrow], space, { x: 21, y: 20 })).toMatchObject({
      part: "a",
    });
  });
});

describe("render draws what hit-testing checks", () => {
  function linesOf(drawing: Drawing): Point[][] {
    const lines: Point[][] = [];
    const target = {
      drawLine: (points: Point[]) => {
        lines.push(points);
      },
      drawShape: () => undefined,
      drawText: () => undefined,
      drawCustom: () => undefined,
    };
    drawOne(
      target as never,
      space,
      { readStyle: () => "", formatValue: String, barIndexAt: (x) => x },
      drawing,
      { width: 1, color: "#000" },
      false,
    );
    return lines;
  }

  it("ray/extended use the same overshoot endpoints as the hit test", () => {
    for (const kind of ["ray", "extended"] as const) {
      const drawing = two(kind);
      const [line] = linesOf(drawing);
      expect(line).toEqual(
        infiniteEndpoints(kind, { x: 20, y: 20 }, { x: 40, y: 40 }, space),
      );
    }
  });

  it("vertical spans the pane's full height at its x", () => {
    const [line] = linesOf({ type: "vertical", id: "v", x: 30 });
    expect(line).toEqual([
      { x: 30, y: 0 },
      { x: 30, y: 100 },
    ]);
  });

  it("arrow draws the shaft plus two barbs", () => {
    const lines = linesOf(two("arrow"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([
      { x: 20, y: 20 },
      { x: 40, y: 40 },
    ]);
    // Both barbs start at the tip.
    expect(lines[1][0]).toEqual({ x: 40, y: 40 });
    expect(lines[2][0]).toEqual({ x: 40, y: 40 });

    // Each barb is 9px long and swept π/7 back from the tip along the
    // shaft — so it points back toward a, not ahead of the tip.
    const back = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }; // unit vector tip → a
    const ends = [lines[1][1], lines[2][1]];
    for (const end of ends) {
      const dx = end.x - 40;
      const dy = end.y - 40;
      expect(Math.hypot(dx, dy)).toBeCloseTo(9, 9);
      expect(dx * back.x + dy * back.y).toBeCloseTo(9 * Math.cos(Math.PI / 7), 9);
    }
    // And the two are mirror images across the shaft: their offsets
    // from the shaft's line cancel, and they don't coincide.
    const side = (end: Point) => (end.x - 40) * back.y - (end.y - 40) * back.x;
    expect(side(ends[0]) + side(ends[1])).toBeCloseTo(0, 9);
    expect(Math.abs(side(ends[0]))).toBeCloseTo(9 * Math.sin(Math.PI / 7), 9);
  });
});

describe("placement and drag through the real state machine", () => {
  const data: LineDataPoint[] = [
    { x: 0, y: 100 },
    { x: 5, y: 120 },
    { x: 10, y: 110 },
  ];

  function mounted() {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    const pane = model.plot.mainPane;
    const route = (
      type: "pointerdown" | "pointermove" | "pointerup",
      point: { x: number; y: number },
    ) => model.plot.routeInput({ type, point, pointerId: 1 });
    return { model, tools, pane, route };
  }

  it("vertical completes on a single click, like its horizontal dual", () => {
    const { model, tools, pane, route } = mounted();
    tools.begin("vertical");
    const px = model.plot.pixelAtX(5);
    const mid = (pane.area.top + pane.area.bottom) / 2;
    route("pointerdown", { x: px, y: mid });
    route("pointerup", { x: px, y: mid });

    expect(tools.mode()).toBeNull();
    const [drawn] = tools.list();
    expect(drawn.type).toBe("vertical");
    if (drawn.type === "vertical") {
      expect(model.plot.pixelAtX(drawn.x)).toBeCloseTo(px, 5);
    }
  });

  it("ray takes two clicks, like a trend line", () => {
    const { model, tools, pane, route } = mounted();
    tools.begin("ray");
    const y = (price: number) => pane.yScale.scale(price);
    route("pointerdown", { x: model.plot.pixelAtX(2), y: y(105) });
    route("pointerup", { x: model.plot.pixelAtX(2), y: y(105) });
    route("pointerdown", { x: model.plot.pixelAtX(8), y: y(115) });
    route("pointerup", { x: model.plot.pixelAtX(8), y: y(115) });

    expect(tools.mode()).toBeNull();
    expect(tools.list()[0]).toMatchObject({ type: "ray" });
  });

  it("dragging a vertical line moves its x — and Esc restores it", () => {
    const { model, tools, pane, route } = mounted();
    tools.add({ type: "vertical", x: 5 });
    const line = tools.handles()[0];
    const px = model.plot.pixelAtX(5);
    const mid = (pane.area.top + pane.area.bottom) / 2;

    route("pointerdown", { x: px, y: mid });
    route("pointermove", { x: px + 40, y: mid });
    const movedX = line.read();
    expect(movedX.type).toBe("vertical");
    if (movedX.type === "vertical") {
      expect(model.plot.pixelAtX(movedX.x)).toBeCloseTo(px + 40, 5);
    }

    model.plot.routeInput({ type: "keydown", key: "Escape" });
    const restored = line.read();
    if (restored.type === "vertical") {
      expect(model.plot.pixelAtX(restored.x)).toBeCloseTo(px, 5);
    }
  });

  it('snap "x": a drafted vertical sticks to a bar\'s x, price-free', () => {
    const { model, tools, pane, route } = mounted();
    tools.setSnap(true);
    tools.begin("vertical");
    const barPx = model.plot.pixelAtX(5);
    const mid = (pane.area.top + pane.area.bottom) / 2;
    // 4px off the bar — inside the default 8px snap radius, at a y far
    // from the bar's value (the old "xy" Euclidean gate would refuse).
    route("pointerdown", { x: barPx + 4, y: mid });
    route("pointerup", { x: barPx + 4, y: mid });

    const [drawn] = tools.list();
    if (drawn.type === "vertical") {
      expect(drawn.x).toBe(5);
    } else {
      throw new Error("expected a vertical");
    }
  });
});

it('clips rays and extended lines whose defining anchors are far off screen', () => {
  for (const type of ['ray', 'extended'] as const) {
    const drawing = { type, id: type, a: { x: -1000, price: 50 }, b: { x: -900, price: 50 } };
    expect(infiniteEndpoints(type, { x: -1000, y: 50 }, { x: -900, y: 50 }, space)).toEqual([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
    expect(gripAt([drawing], space, { x: 50, y: 50 })?.part).toBe('whole');
    expect(infiniteEndpoints(type, { x: 1e308, y: 1e308 }, { x: 0, y: 0 }, space)).toEqual([{ x: 100, y: 100 }, { x: 0, y: 0 }]);
    // Reversing a ray points away; extending the full line still crosses.
    expect(gripAt([{ ...drawing, a: drawing.b, b: drawing.a }], space, { x: 50, y: 50 })?.part).toBe(type === 'ray' ? undefined : 'whole');
  }
});
