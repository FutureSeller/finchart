import { describe, expect, it } from "vitest";
import { drawingChart } from "./drawing-chart.fixture";

/**
 * Pointer ownership. The router's capture is per pointer (pinch tracks
 * two pointers), but if the tool's gesture state is a
 * single global, finger B on a tablet overwrites finger A's drag. A
 * gesture belongs to the pointerId that started it; other pointers are
 * consumed but ignored.
 */

function mounted() {
  const chart = drawingChart();

  const routeAs = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
    pointerId: number,
  ) => chart.route({ type, point, pointerId });

  return { ...chart, routeAs };
}

describe("drawingTools pointer ownership", () => {
  it("should keep the drag with the finger that started it", () => {
    const { tools, routeAs, pane } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    const midX = (pane.area.left + pane.area.right) / 2;
    const yOf = (price: number) => pane.yScale.scale(price);

    // Finger 1 grabs the 105 line.
    expect(routeAs("pointerdown", { x: midX, y: yOf(105) }, 1)).toBe(true);
    // Finger 2 touches the 115 line -- consumed but ignored: neither
    // selection nor drag changes.
    expect(routeAs("pointerdown", { x: midX, y: yOf(115) }, 2)).toBe(true);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 105 });

    // Finger 2's move and up move nothing.
    routeAs("pointermove", { x: midX, y: yOf(119) }, 2);
    routeAs("pointerup", { x: midX, y: yOf(119) }, 2);
    const prices = () =>
      tools
        .list()
        .map((d) => (d.type === "horizontal" ? d.price : null))
        .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(prices().map((p) => Math.round(p ?? 0))).toEqual([105, 115]);

    // Even after finger 2 lifts, finger 1's drag is still alive.
    routeAs("pointermove", { x: midX, y: yOf(109) }, 1);
    expect(Math.round(prices()[1] ?? 0)).toBe(115);
    expect(Math.round(prices()[0] ?? 0)).toBe(109);

    routeAs("pointerup", { x: midX, y: yOf(109) }, 1);
  });

  it("should not let a second finger freeze the stroke being drawn", () => {
    const { tools, routeAs, at } = mounted();
    tools.begin("trend");

    routeAs("pointerdown", at(2, 105), 1);
    routeAs("pointermove", at(5, 110), 1);
    // A second finger -- mistaken for a "second click," it would lock
    // the line in right here.
    expect(routeAs("pointerdown", at(9, 118), 2)).toBe(true);
    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBe("trend");

    // The finger that started drawing owns the gesture through to the end.
    routeAs("pointermove", at(8, 115), 1);
    routeAs("pointerup", at(8, 115), 1);

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(placed.b.price).toBeCloseTo(115, 6);
  });

  it("should hand the drag to whichever pointer grabbed it", () => {
    const { tools, routeAs, pane } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });

    const midX = (pane.area.left + pane.area.right) / 2;
    const yOf = (price: number) => pane.yScale.scale(price);
    const price = () => {
      const line = handle.read();
      return line.type === "horizontal" ? Math.round(line.price) : null;
    };

    // Finger 2 grabs the line, so finger 2 moves it.
    expect(routeAs("pointerdown", { x: midX, y: yOf(105) }, 2)).toBe(true);
    routeAs("pointermove", { x: midX, y: yOf(109) }, 2);
    expect(price()).toBe(109);

    // Pointer 1 never touched it -- its move goes nowhere.
    routeAs("pointermove", { x: midX, y: yOf(113) }, 1);
    expect(price()).toBe(109);

    routeAs("pointerup", { x: midX, y: yOf(109) }, 2);
  });

  it("should not let a second finger's move pull the line being drawn", () => {
    const { model, plot, tools, routeAs, at } = mounted();
    tools.begin("trend");

    routeAs("pointerdown", at(2, 105), 1);
    routeAs("pointermove", at(5, 110), 1);
    expect(routeAs("pointermove", at(9, 118), 2)).toBe(true);

    // Draw a fresh frame, so a draft changed without asking for one shows too.
    plot.render();
    const lines = model
      .commands()
      .filter((command) => command.type === "drawLine");
    expect(lines.at(-1)?.points).toEqual([at(2, 105), at(5, 110)]);
  });

  it("should accept the second tap from a new pointerId (touch taps)", () => {
    const { tools, routeAs, at } = mounted();
    tools.begin("trend");

    // Each touch tap gets a fresh pointerId -- the first tap is pointer 2.
    routeAs("pointerdown", at(2, 105), 2);
    routeAs("pointerup", at(2, 105), 2);
    expect(tools.list()).toHaveLength(0);

    // In the "in-between" stretch after the owning pointer has lifted,
    // the second tap can belong to anyone.
    routeAs("pointerdown", at(8, 115), 3);

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.a.x).toBeCloseTo(2, 6);
    expect(placed.b.x).toBeCloseTo(8, 6);
  });
});
