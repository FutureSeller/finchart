import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it, vi } from "vitest";
import { drawingTools } from "../tools";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

/**
 * The stage is headless, so there's no visible cursor -- what's measured
 * here is **the claim's lifetime**. The path where the shape actually
 * reaches the screen is already covered by the core's cursor.test.ts.
 */
function mounted() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });

  const active: string[] = [];
  const original = model.plot.claimCursor.bind(model.plot);
  vi.spyOn(model.plot, "claimCursor").mockImplementation((cursor: string) => {
    active.push(cursor);
    const release = original(cursor);
    return () => {
      const index = active.lastIndexOf(cursor);
      if (index !== -1) active.splice(index, 1);
      release();
    };
  });

  const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const pane = model.plot.mainPane;

  const route = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
  ) => model.plot.routeInput({ type, point, pointerId: 1 });

  return { model, tools, pane, route, active };
}

describe("drawingTools cursor", () => {
  it("should aim while placing and let go when the drawing lands", () => {
    const { tools, pane, route, active } = mounted();

    tools.begin("horizontal");
    expect(active).toEqual(["crosshair"]);

    // First click -- still drawing.
    const mid = {
      x: (pane.area.left + pane.area.right) / 2,
      y: (pane.area.top + pane.area.bottom) / 2,
    };
    route("pointerdown", mid);
    expect(active).toEqual(["crosshair"]);

    // Release completes it -- the aim clears.
    route("pointerup", mid);
    expect(active).toEqual([]);
  });

  it("should let go of the aim on cancel", () => {
    const { tools, active } = mounted();

    tools.begin("trend");
    expect(active).toEqual(["crosshair"]);

    tools.cancel();
    expect(active).toEqual([]);
  });

  it("should grip during a drag and let go on release", () => {
    const { tools, pane, route, active } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const grabX = (pane.area.left + pane.area.right) / 2;
    const grabY = pane.yScale.scale(110);

    route("pointerdown", { x: grabX, y: grabY + 3 });
    expect(active).toEqual(["grabbing"]);

    route("pointermove", { x: grabX, y: grabY + 43 });
    expect(active).toEqual(["grabbing"]);

    route("pointerup", { x: grabX, y: grabY + 43 });
    expect(active).toEqual([]);
  });

  it("should hand the claim back when the plugin is disposed mid-mode", () => {
    const { tools, active } = mounted();

    tools.begin("horizontal");
    expect(active).toEqual(["crosshair"]);

    // The path where the tool is disposed mid-draw -- the stage
    // outlives the tool.
    tools.dispose();
    expect(active).toEqual([]);
  });
});

/**
 * Hovering over a line shows a signal that it can be grabbed. State
 * cursors alone (`crosshair` for drawing, `grabbing` for dragging) give
 * no way to discover a shape before selecting it, so a user would have
 * to press down just to find out whether a shape is there.
 */
describe("drawingTools hover cursor", () => {
  function onTheLine() {
    const harness = mounted();
    harness.tools.add({ type: "horizontal", price: 110 });
    const x = (harness.pane.area.left + harness.pane.area.right) / 2;
    return { ...harness, x, y: harness.pane.yScale.scale(110) };
  }

  it("should claim grab while hovering a drawing", () => {
    const { route, active, x, y } = onTheLine();

    route("pointermove", { x, y: y + 3 });
    expect(active).toEqual(["grab"]);
  });

  /**
   * Hover backs off while aiming -- the `transition` cursor rule only
   * runs on state transitions, so a pointer that merely moves across a
   * shape could wrongly stack `grab` on top of `crosshair`. This pins
   * down the spot where `begin()` and hover intersect.
   */
  it("should keep aiming when the pointer crosses a drawing while armed", () => {
    const { tools, route, active, x, y } = onTheLine();

    tools.begin("trend");
    expect(active).toEqual(["crosshair"]);

    // Pass over an existing shape -- since we're drawing, no grab
    // signal should appear.
    route("pointermove", { x, y: y + 3 });
    expect(active).toEqual(["crosshair"]);

    // Stays steady even after leaving the shape.
    route("pointermove", { x, y: y + 80 });
    expect(active).toEqual(["crosshair"]);
  });

  it("should let go when the pointer leaves the drawing", () => {
    const { route, active, x, y } = onTheLine();

    route("pointermove", { x, y: y + 3 });
    expect(active).toEqual(["grab"]);

    route("pointermove", { x, y: y + 200 });
    expect(active).toEqual([]);
  });

  /**
   * **Doesn't consume it.** Returning `true` from hover would kill the
   * crosshair -- the contract here is to claim only the cursor and let
   * the event pass through.
   */
  it("should not eat the pointermove it claims a cursor for", () => {
    const { model, x, y } = onTheLine();

    const eaten = model.plot.routeInput({
      type: "pointermove",
      point: { x, y: y + 3 },
      pointerId: 1,
    });

    expect(eaten).toBe(false);
  });

  it("should hand the cursor over to grabbing on drag", () => {
    const { route, active, x, y } = onTheLine();

    route("pointermove", { x, y: y + 3 });
    expect(active).toEqual(["grab"]);

    // On grab, hover backs off and only grabbing remains -- the two
    // never overlap.
    route("pointerdown", { x, y: y + 3 });
    expect(active).toEqual(["grabbing"]);
  });

  it("should release the hover claim on dispose", () => {
    const { tools, route, active, x, y } = onTheLine();

    route("pointermove", { x, y: y + 3 });
    expect(active).toEqual(["grab"]);

    tools.dispose();
    expect(active).toEqual([]);
  });
});
