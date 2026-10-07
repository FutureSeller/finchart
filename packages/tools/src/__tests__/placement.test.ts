import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

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

  const route = (event: Parameters<typeof model.plot.routeInput>[0]) =>
    model.plot.routeInput(event);

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

describe("drawingTools placement", () => {
  it("should place a horizontal line at the pressed price", () => {
    const { tools, route, at } = mounted();
    tools.begin("horizontal");

    const press = at(5, 110);
    expect(route({ type: "pointerdown", point: press, pointerId: 1 })).toBe(
      true,
    );
    route({ type: "pointerup", point: press, pointerId: 1 });

    const [placed] = tools.list();
    expect(placed.type).toBe("horizontal");
    if (placed.type !== "horizontal") return;
    expect(placed.price).toBeCloseTo(110, 6);
    // Completion is selection, and the pending state clears itself.
    expect(tools.selection()).toEqual(placed);
    expect(tools.mode()).toBeNull();
  });

  it("should draw a trend line with press-drag-release", () => {
    const { tools, route, at } = mounted();
    tools.begin("trend");

    route({ type: "pointerdown", point: at(2, 105), pointerId: 1 });
    route({ type: "pointermove", point: at(8, 115), pointerId: 1 });
    route({ type: "pointerup", point: at(8, 115), pointerId: 1 });

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.a.x).toBeCloseTo(2, 6);
    expect(placed.a.price).toBeCloseTo(105, 6);
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(placed.b.price).toBeCloseTo(115, 6);
    expect(tools.mode()).toBeNull();
  });

  it("should draw a fib with click, move, click", () => {
    const { tools, route, at } = mounted();
    tools.begin("fib");

    const first = at(2, 105);
    route({ type: "pointerdown", point: first, pointerId: 1 });
    // Released in place -- that's a click. Drawing continues.
    route({ type: "pointerup", point: first, pointerId: 1 });
    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBe("fib");

    // Hover movement drags b along.
    route({ type: "pointermove", point: at(6, 112), pointerId: 1 });
    // The second click locks b in.
    route({ type: "pointerdown", point: at(8, 115), pointerId: 1 });

    const [placed] = tools.list();
    expect(placed.type).toBe("fib");
    if (placed.type !== "fib") return;
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(tools.mode()).toBeNull();
  });

  it("should draw the line being drafted before it is finished", () => {
    const { model, tools, route, at } = mounted();
    const lines = () => model.commands().filter((command) => command.type === "drawLine");
    const before = lines().length;

    tools.begin("trend");
    route({ type: "pointerdown", point: at(2, 105), pointerId: 1 });
    route({ type: "pointermove", point: at(8, 115), pointerId: 1 });

    const drawn = lines();
    expect(tools.list()).toHaveLength(0);
    expect(drawn).toHaveLength(before + 1);
    expect(drawn.at(-1)?.points).toEqual([at(2, 105), at(8, 115)]);
    model.plot.destroy();
  });

  /** Under five pixels of travel the press placed one anchor; five or more drew the whole line in one gesture. */
  it("should tell a click from a drag at five pixels of travel", () => {
    const click = mounted();
    click.tools.begin("trend");
    const start = click.at(2, 105);
    click.route({ type: "pointerdown", point: start, pointerId: 1 });
    click.route({ type: "pointerup", point: { x: start.x + 4, y: start.y }, pointerId: 1 });
    expect(click.tools.list()).toHaveLength(0);
    expect(click.tools.mode()).toBe("trend");
    click.model.plot.destroy();

    const drag = mounted();
    drag.tools.begin("trend");
    const dragStart = drag.at(2, 105);
    drag.route({ type: "pointerdown", point: dragStart, pointerId: 1 });
    drag.route({ type: "pointerup", point: { x: dragStart.x + 5, y: dragStart.y }, pointerId: 1 });
    expect(drag.tools.list()).toHaveLength(1);
    expect(drag.tools.mode()).toBeNull();
    drag.model.plot.destroy();
  });

  it("should keep the draft out of the list and serialization", () => {
    const { tools, route, at } = mounted();
    tools.begin("trend");
    route({ type: "pointerdown", point: at(2, 105), pointerId: 1 });
    route({ type: "pointermove", point: at(6, 112), pointerId: 1 });

    expect(tools.list()).toHaveLength(0);
    expect(tools.serialize()).toBe(
      JSON.stringify({ version: 2, drawings: [] }),
    );
  });

  it("should throw the draft away on Escape", () => {
    const { tools, route, at } = mounted();
    const modes: Array<string | null> = [];
    tools.modeChanges.subscribe(({ mode }) => modes.push(mode));

    tools.begin("trend");
    route({ type: "pointerdown", point: at(2, 105), pointerId: 1 });
    expect(route({ type: "keydown", key: "Escape" })).toBe(true);

    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBeNull();
    expect(modes).toEqual(["trend", null]);
  });

  it("should eat the gesture so placement never pans the chart", () => {
    const { model, tools, route, at } = mounted();
    const before = model.plot.getVisibleRange();

    tools.begin("trend");
    route({ type: "pointerdown", point: at(2, 105), pointerId: 1 });
    route({ type: "pointermove", point: at(8, 115), pointerId: 1 });
    route({ type: "pointerup", point: at(8, 115), pointerId: 1 });

    expect(model.plot.getVisibleRange()).toEqual(before);
  });

  it("should decline a press outside the pane while armed", () => {
    const { tools, route, pane } = mounted();
    tools.begin("horizontal");

    const outside = { x: pane.area.left - 20, y: pane.area.top + 10 };
    expect(route({ type: "pointerdown", point: outside, pointerId: 1 })).toBe(
      false,
    );
    expect(tools.list()).toHaveLength(0);
    // The pending state is unchanged -- the next press still draws.
    expect(tools.mode()).toBe("horizontal");
  });

  it("should announce the finish so a toolbar can release its button", () => {
    const { tools, route, at } = mounted();
    const modes: Array<string | null> = [];
    tools.modeChanges.subscribe(({ mode }) => modes.push(mode));

    tools.begin("horizontal");
    const press = at(5, 110);
    route({ type: "pointerdown", point: press, pointerId: 1 });
    route({ type: "pointerup", point: press, pointerId: 1 });

    expect(modes).toEqual(["horizontal", null]);
  });
});
