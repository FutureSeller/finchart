import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

/**
 * Pointer ownership. The router's capture is per pointer (pinch tracks
 * two pointers), but if the tool's gesture state is a
 * single global, finger B on a tablet overwrites finger A's drag. A
 * gesture belongs to the pointerId that started it; other pointers are
 * consumed but ignored.
 */

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
  model.plot.render();

  const route = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
    pointerId: number,
  ) => model.plot.routeInput({ type, point, pointerId });

  /**
   * Domain (x, price) -> pixels, through the chart itself — the fit pads
   * the data range (0-10) by half a bar at each end.
   */
  const at = (x: number, price: number) => ({
    x: model.plot.pixelAtX(x),
    y: pane.yScale.scale(price),
  });

  return { model, tools, pane, route, at };
}

describe("drawingTools pointer ownership", () => {
  it("should keep the drag with the finger that started it", () => {
    const { tools, route, pane } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    const midX = (pane.area.left + pane.area.right) / 2;
    const yOf = (price: number) => pane.yScale.scale(price);

    // Finger 1 grabs the 105 line.
    expect(route("pointerdown", { x: midX, y: yOf(105) }, 1)).toBe(true);
    // Finger 2 touches the 115 line -- consumed but ignored: neither
    // selection nor drag changes.
    expect(route("pointerdown", { x: midX, y: yOf(115) }, 2)).toBe(true);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 105 });

    // Finger 2's move and up move nothing.
    route("pointermove", { x: midX, y: yOf(119) }, 2);
    route("pointerup", { x: midX, y: yOf(119) }, 2);
    const prices = () =>
      tools
        .list()
        .map((d) => (d.type === "horizontal" ? d.price : null))
        .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(prices().map((p) => Math.round(p ?? 0))).toEqual([105, 115]);

    // Even after finger 2 lifts, finger 1's drag is still alive.
    route("pointermove", { x: midX, y: yOf(109) }, 1);
    expect(Math.round(prices()[1] ?? 0)).toBe(115);
    expect(Math.round(prices()[0] ?? 0)).toBe(109);

    route("pointerup", { x: midX, y: yOf(109) }, 1);
  });

  it("should not let a second finger freeze the stroke being drawn", () => {
    const { tools, route, at } = mounted();
    tools.begin("trend");

    route("pointerdown", at(2, 105), 1);
    route("pointermove", at(5, 110), 1);
    // A second finger -- this used to be mistaken for a "second click,"
    // which locked the line in right here.
    expect(route("pointerdown", at(9, 118), 2)).toBe(true);
    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBe("trend");

    // The finger that started drawing owns the gesture through to the end.
    route("pointermove", at(8, 115), 1);
    route("pointerup", at(8, 115), 1);

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(placed.b.price).toBeCloseTo(115, 6);
  });

  it("should accept the second tap from a new pointerId (touch taps)", () => {
    const { tools, route, at } = mounted();
    tools.begin("trend");

    // Each touch tap gets a fresh pointerId -- the first tap is pointer 2.
    route("pointerdown", at(2, 105), 2);
    route("pointerup", at(2, 105), 2);
    expect(tools.list()).toHaveLength(0);

    // In the "in-between" stretch after the owning pointer has lifted,
    // the second tap can belong to anyone.
    route("pointerdown", at(8, 115), 3);

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.a.x).toBeCloseTo(2, 6);
    expect(placed.b.x).toBeCloseTo(8, 6);
  });
});
