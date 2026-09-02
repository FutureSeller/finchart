import type { LineDataPoint, Point, TextParams } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { priceMeasureDelta } from "../drawings";
import { ellipseOutline, gripAt, rectangleOutline } from "../hit";
import type { DrawingRenderContext } from "../render";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";
import { drawingTools } from "../tools";

/**
 * T2 wave — rectangle · ellipse · priceMeasure · barMeasure. The area
 * kinds hit on their boundary only (a filled interior is a separate
 * decision); the measures hit on their segment and carry a label the
 * renderer sizes. The kind table (kind-spec.test.ts) pins serialization.
 */

const space: DrawingSpace = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

const box = (type: "rectangle" | "ellipse" | "priceMeasure" | "barMeasure"): Drawing => ({
  type,
  id: type,
  a: { x: 20, price: 20 },
  b: { x: 60, price: 50 },
});

describe("hit vocabulary", () => {
  it("rectangle: the boundary is grabbable, the interior is not", () => {
    const rectangle = box("rectangle");
    // Mid-left edge, mid-top edge.
    expect(gripAt([rectangle], space, { x: 20, y: 35 })).toMatchObject({ part: "whole" });
    expect(gripAt([rectangle], space, { x: 40, y: 50 })).toMatchObject({ part: "whole" });
    // Dead center — inside, not on the boundary.
    expect(gripAt([rectangle], space, { x: 40, y: 35 })).toBeNull();
    // Corners are handles, and handles win.
    expect(gripAt([rectangle], space, { x: 21, y: 21 })).toMatchObject({ part: "a" });
    expect(gripAt([rectangle], space, { x: 59, y: 49 })).toMatchObject({ part: "b" });
  });

  it("ellipse: the boundary is grabbable, the interior and the bounding-box corner are not", () => {
    const ellipse = box("ellipse");
    // The leftmost point of the ellipse (cx - rx, cy) = (20, 35).
    expect(gripAt([ellipse], space, { x: 20, y: 35 })).toMatchObject({ part: "whole" });
    // The topmost point (cx, cy - ry) = (40, 20).
    expect(gripAt([ellipse], space, { x: 40, y: 20 })).toMatchObject({ part: "whole" });
    // A point on the arc at 45° — on the ellipse, but ~6px inside the
    // bounding box's edges (a box outline would miss it).
    expect(
      gripAt([ellipse], space, { x: 40 + 20 * Math.SQRT1_2, y: 35 + 15 * Math.SQRT1_2 }),
    ).toMatchObject({ part: "whole" });
    // Center — inside.
    expect(gripAt([ellipse], space, { x: 40, y: 35 })).toBeNull();
    // Inside the box but well off the arc (the nearest arc point is
    // ~7px away) — neither the boundary nor a corner handle.
    expect(gripAt([ellipse], space, { x: 30, y: 30 })).toBeNull();
  });

  it("priceMeasure / barMeasure: the segment is the hit target", () => {
    for (const kind of ["priceMeasure", "barMeasure"] as const) {
      const measure = box(kind);
      // Midpoint of a–b.
      expect(gripAt([measure], space, { x: 40, y: 35 })).toMatchObject({ part: "whole" });
      // A rectangle's edge point — off the diagonal.
      expect(gripAt([measure], space, { x: 20, y: 35 })).toBeNull();
      expect(gripAt([measure], space, { x: 21, y: 20 })).toMatchObject({ part: "a" });
    }
  });
});

describe("render draws what hit-testing checks", () => {
  function record(drawing: Drawing, context?: Partial<DrawingRenderContext>) {
    const lines: Point[][] = [];
    const texts: TextParams[] = [];
    const target = {
      drawLine: (points: Point[]) => {
        lines.push(points);
      },
      drawShape: () => undefined,
      drawText: (params: TextParams) => {
        texts.push(params);
      },
      drawCustom: () => undefined,
    };
    const full: DrawingRenderContext = {
      readStyle: () => "",
      formatValue: (value) => value.toFixed(2),
      barIndexAt: (x) => x,
      ...context,
    };
    drawOne(target as never, space, full, drawing, { width: 1, color: "#000" }, false);
    return { lines, texts };
  }

  it("rectangle: one closed outline, the same corners hit-testing walks", () => {
    const { lines } = record(box("rectangle"));
    expect(lines).toHaveLength(1);
    const outline = rectangleOutline({ x: 20, y: 20 }, { x: 60, y: 50 });
    expect(lines[0]).toEqual([...outline, outline[0]]);
    expect(outline).toEqual([
      { x: 20, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 50 },
      { x: 20, y: 50 },
    ]);
  });

  it("ellipse: one closed outline from the shared arc function", () => {
    const { lines } = record(box("ellipse"));
    expect(lines).toHaveLength(1);
    const outline = ellipseOutline({ x: 20, y: 20 }, { x: 60, y: 50 });
    expect(lines[0]).toEqual([...outline, outline[0]]);
    // Every sample sits on the ellipse: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 = 1.
    for (const point of outline) {
      const nx = (point.x - 40) / 20;
      const ny = (point.y - 35) / 15;
      expect(nx * nx + ny * ny).toBeCloseTo(1, 9);
    }
  });

  it("priceMeasure: the segment plus a boxed label with delta and percent", () => {
    const { lines, texts } = record(box("priceMeasure"));
    expect(lines).toEqual([[{ x: 20, y: 20 }, { x: 60, y: 50 }]]);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("+30.00 (+150.00%)");
    expect(texts[0].at).toEqual({ x: 40, y: 35 });
    expect(texts[0].box).toBeDefined();
  });

  it("priceMeasure: a negative move keeps its sign, and a zero base drops the percent", () => {
    const down: Drawing = {
      type: "priceMeasure",
      id: "d",
      a: { x: 20, price: 50 },
      b: { x: 60, price: 20 },
    };
    expect(record(down).texts[0].text).toBe("-30.00 (-60.00%)");
    expect(priceMeasureDelta(down)).toBe(-30);

    const fromZero: Drawing = {
      type: "priceMeasure",
      id: "z",
      a: { x: 20, price: 0 },
      b: { x: 60, price: 20 },
    };
    expect(record(fromZero).texts[0].text).toBe("+20.00");
  });

  it("barMeasure: counts bars by the pane's bar index, not by x", () => {
    // Bars every 10 x — data x 20..60 are bars 2..6.
    const { lines, texts } = record(box("barMeasure"), {
      barIndexAt: (x) => Math.round(x / 10),
    });
    expect(lines).toEqual([[{ x: 20, y: 20 }, { x: 60, y: 50 }]]);
    expect(texts[0].text).toBe("4 bars");
    expect(texts[0].box).toBeDefined();
  });

  it("barMeasure: one bar is singular, and direction does not matter", () => {
    const backwards: Drawing = {
      type: "barMeasure",
      id: "b",
      a: { x: 30, price: 20 },
      b: { x: 20, price: 50 },
    };
    expect(record(backwards, { barIndexAt: (x) => Math.round(x / 10) }).texts[0].text).toBe("1 bar");
  });

  it("barMeasure: no bars, no label — the segment still draws", () => {
    const { lines, texts } = record(box("barMeasure"), { barIndexAt: () => null });
    expect(lines).toHaveLength(1);
    expect(texts).toHaveLength(0);
  });

  it("the label's text color comes from its own token", () => {
    const { texts } = record(box("barMeasure"), {
      readStyle: (name) => (name === "--chart-drawing-label" ? "#123456" : ""),
    });
    expect(texts[0].style.color).toBe("#123456");
    expect(texts[0].box?.fill).toBe("#000");
  });
});

describe("placement and editing through the real state machine", () => {
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
    const at = (x: number, price: number) => ({
      x: model.plot.pixelAtX(x),
      y: pane.yScale.scale(price),
    });
    return { model, tools, pane, route, at };
  }

  it.each(["rectangle", "ellipse", "priceMeasure", "barMeasure"] as const)(
    "%s takes two clicks, like a trend line",
    (kind) => {
      const { tools, route, at } = mounted();
      tools.begin(kind);
      route("pointerdown", at(2, 105));
      route("pointerup", at(2, 105));
      route("pointerdown", at(8, 115));
      route("pointerup", at(8, 115));

      expect(tools.mode()).toBeNull();
      const [drawn] = tools.list();
      expect(drawn).toMatchObject({ type: kind });
      if ("a" in drawn) {
        expect(drawn.a.x).toBeCloseTo(2, 5);
        expect(drawn.b.x).toBeCloseTo(8, 5);
      }
    },
  );

  it("a rectangle drawn by dragging finishes on release", () => {
    const { tools, route, at } = mounted();
    tools.begin("rectangle");
    route("pointerdown", at(2, 105));
    route("pointermove", at(8, 115));
    route("pointerup", at(8, 115));

    expect(tools.mode()).toBeNull();
    expect(tools.list()[0]).toMatchObject({ type: "rectangle" });
  });

  it("dragging a rectangle's edge moves the whole thing — and Esc restores it", () => {
    const { model, tools, route, at } = mounted();
    tools.add({ type: "rectangle", a: { x: 2, price: 105 }, b: { x: 8, price: 115 } });
    const [handle] = tools.handles();
    // Mid-left edge.
    const edge = at(2, 110);

    route("pointerdown", edge);
    route("pointermove", { x: edge.x + 40, y: edge.y });
    const moved = handle.read();
    if (moved.type !== "rectangle") throw new Error("expected a rectangle");
    expect(model.plot.pixelAtX(moved.a.x)).toBeCloseTo(edge.x + 40, 5);
    expect(moved.b.x - moved.a.x).toBeCloseTo(6, 5);

    model.plot.routeInput({ type: "keydown", key: "Escape" });
    const restored = handle.read();
    if (restored.type !== "rectangle") throw new Error("expected a rectangle");
    expect(restored.a.x).toBeCloseTo(2, 5);
  });

  it("handle.update patches a measure's anchor in place", () => {
    const { tools } = mounted();
    tools.add({ type: "barMeasure", a: { x: 2, price: 105 }, b: { x: 8, price: 115 } });
    const [handle] = tools.handles();
    handle.update({ b: { x: 9, price: 115 } });
    expect(handle.read()).toMatchObject({ type: "barMeasure", b: { x: 9, price: 115 } });
  });
});
