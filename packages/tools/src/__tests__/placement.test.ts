import { describe, expect, it } from "vitest";
import { drawingChart, record } from "./drawing-chart.fixture";

describe("drawingTools placement", () => {
  it("should place a horizontal line at the pressed price", () => {
    const { tools, click } = drawingChart();
    tools.begin("horizontal");

    expect(click({ x: 5, price: 110 })).toBe(true);

    const [placed] = tools.list();
    expect(placed.type).toBe("horizontal");
    if (placed.type !== "horizontal") return;
    expect(placed.price).toBeCloseTo(110, 6);
    // Completion is selection, and the pending state clears itself.
    expect(tools.selection()).toEqual(placed);
    expect(tools.mode()).toBeNull();
  });

  it("should draw a trend line with press-drag-release", () => {
    const { tools, drag } = drawingChart();
    tools.begin("trend");

    drag({ x: 2, price: 105 }, { x: 8, price: 115 });

    const [placed] = tools.list();
    expect(placed.type).toBe("trend");
    if (placed.type !== "trend") return;
    expect(placed.a.x).toBeCloseTo(2, 6);
    expect(placed.a.price).toBeCloseTo(105, 6);
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(placed.b.price).toBeCloseTo(115, 6);
    expect(tools.mode()).toBeNull();
  });

  /**
   * The 5px boundary is shared with the chart's pan: exactly 5px of travel
   * is a click, and only more is a drag. Pan counts the farthest horizontal
   * travel during the press; placement counts the straight-line distance
   * from press to release.
   * Integer pixels keep the travel exact (snapping is off by default).
   */
  describe("click or drag at the pan's click boundary", () => {
    const press = { x: 200, y: 300 };
    const offsetFrom = (point: { x: number; y: number }, dx: number, dy: number) => ({
      x: point.x + dx,
      y: point.y + dy,
    });

    it.each([
      ["horizontally", 5, 0],
      ["diagonally", 3, 4],
    ])(
      "should treat 5px of travel %s as a click, so the next click finishes the line",
      (_, dx, dy) => {
        const { plot, pane, tools, route } = drawingChart();
        tools.begin("trend");

        const release = offsetFrom(press, dx, dy);
        expect(Math.hypot(release.x - press.x, release.y - press.y)).toBe(5);
        route({ type: "pointerdown", point: press, pointerId: 1 });
        route({ type: "pointermove", point: release, pointerId: 1 });
        route({ type: "pointerup", point: release, pointerId: 1 });

        expect(tools.list()).toHaveLength(0);
        expect(tools.mode()).toBe("trend");

        const second = { x: 300, y: 200 };
        route({ type: "pointermove", point: second, pointerId: 1 });
        route({ type: "pointerdown", point: second, pointerId: 1 });
        route({ type: "pointerup", point: second, pointerId: 1 });

        const [placed] = tools.list();
        expect(placed.type).toBe("trend");
        if (placed.type !== "trend") return;
        expect(plot.pixelAtX(placed.a.x)).toBeCloseTo(press.x, 6);
        expect(pane.yScale.scale(placed.a.price)).toBeCloseTo(press.y, 6);
        expect(plot.pixelAtX(placed.b.x)).toBeCloseTo(second.x, 6);
        expect(pane.yScale.scale(placed.b.price)).toBeCloseTo(second.y, 6);
      },
    );

    // (4, 4) is about 5.66px straight-line but only 4px along either axis;
    // (5, 1) is about 5.10px, just past the boundary.
    it.each([
      ["6px horizontally", 6, 0],
      ["6px vertically", 0, 6],
      ["about 5.66px diagonally", 4, 4],
      ["about 5.10px diagonally", 5, 1],
    ])(
      "should treat travel of %s as a drag and draw the whole line",
      (_, dx, dy) => {
        const { plot, pane, tools, route } = drawingChart();
        tools.begin("trend");

        const release = offsetFrom(press, dx, dy);
        route({ type: "pointerdown", point: press, pointerId: 1 });
        route({ type: "pointermove", point: release, pointerId: 1 });
        route({ type: "pointerup", point: release, pointerId: 1 });

        const [placed] = tools.list();
        expect(placed.type).toBe("trend");
        if (placed.type !== "trend") return;
        expect(plot.pixelAtX(placed.a.x)).toBeCloseTo(press.x, 6);
        expect(pane.yScale.scale(placed.a.price)).toBeCloseTo(press.y, 6);
        expect(plot.pixelAtX(placed.b.x)).toBeCloseTo(release.x, 6);
        expect(pane.yScale.scale(placed.b.price)).toBeCloseTo(release.y, 6);
        expect(tools.mode()).toBeNull();
      },
    );
  });

  it("should draw a fib with click, move, click", () => {
    const { tools, hover, press, click } = drawingChart();
    tools.begin("fib");

    // Released in place -- that's a click. Drawing continues.
    click({ x: 2, price: 105 });
    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBe("fib");

    // Hover movement drags b along.
    hover({ x: 6, price: 112 });
    // The second click locks b in.
    press({ x: 8, price: 115 });

    const [placed] = tools.list();
    expect(placed.type).toBe("fib");
    if (placed.type !== "fib") return;
    expect(placed.b.x).toBeCloseTo(8, 6);
    expect(tools.mode()).toBeNull();
  });

  it("should draw the line being drafted before it is finished", () => {
    const { model, tools, at, press } = drawingChart();
    const lines = () => model.commands().filter((command) => command.type === "drawLine");
    const before = lines().length;

    tools.begin("trend");
    press({ x: 2, price: 105 }).moveTo({ x: 8, price: 115 });

    const drawn = lines();
    expect(tools.list()).toHaveLength(0);
    expect(drawn).toHaveLength(before + 1);
    expect(drawn.at(-1)?.points).toEqual([at(2, 105), at(8, 115)]);
  });

  it("should keep the draft out of the list and serialization", () => {
    const { tools, press } = drawingChart();
    tools.begin("trend");
    press({ x: 2, price: 105 }).moveTo({ x: 6, price: 112 });

    expect(tools.list()).toHaveLength(0);
    expect(tools.serialize()).toBe(
      JSON.stringify({ version: 2, drawings: [] }),
    );
  });

  it("should throw the draft away on Escape", () => {
    const { tools, press, key } = drawingChart();
    const modes = record(tools.modeChanges);

    tools.begin("trend");
    press({ x: 2, price: 105 });
    expect(key("Escape")).toBe(true);

    expect(tools.list()).toHaveLength(0);
    expect(tools.mode()).toBeNull();
    expect(modes.map(({ mode }) => mode)).toEqual(["trend", null]);
  });

  it("should eat the gesture so placement never pans the chart", () => {
    const { plot, tools, drag } = drawingChart();
    const before = plot.getVisibleRange();

    tools.begin("trend");
    drag({ x: 2, price: 105 }, { x: 8, price: 115 });

    expect(plot.getVisibleRange()).toEqual(before);
  });

  it("should decline a press outside the pane while armed", () => {
    const { pane, tools, press } = drawingChart();
    const { area } = pane;
    tools.begin("horizontal");

    expect(press({ px: area.left - 20, py: area.top + 10 }).down).toBe(false);
    expect(tools.list()).toHaveLength(0);
    // The pending state is unchanged -- the next press still draws.
    expect(tools.mode()).toBe("horizontal");
  });

  it("should announce the finish so a toolbar can release its button", () => {
    const { tools, click } = drawingChart();
    const modes = record(tools.modeChanges);

    tools.begin("horizontal");
    click({ x: 5, price: 110 });

    expect(modes.map(({ mode }) => mode)).toEqual(["horizontal", null]);
  });
});
