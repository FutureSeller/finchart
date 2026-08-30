import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { createPlotModel } from "../model";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function mounted() {
  const deps = testBrowserDeps();
  const { plot, layers } = mountPlot({ deps, series: lineSeries(), data });
  return { plot, layers };
}

describe("claimCursor", () => {
  it("should hand the cursor to the layers and take it back on release", () => {
    const { plot, layers } = mounted();

    const release = plot.claimCursor("grabbing");
    expect(layers.cursor).toBe("grabbing");

    release();
    expect(layers.cursor).toBeNull();
  });

  it("should let the last claim win and fall back on release", () => {
    const { plot, layers } = mounted();

    // Exactly the shape of a drag stacking on top of a hover.
    const hover = plot.claimCursor("grab");
    const drag = plot.claimCursor("grabbing");
    expect(layers.cursor).toBe("grabbing");

    drag();
    expect(layers.cursor).toBe("grab");
    hover();
    expect(layers.cursor).toBeNull();
  });

  it("should keep the top when a buried claim is released", () => {
    const { plot, layers } = mounted();

    const buried = plot.claimCursor("grab");
    plot.claimCursor("grabbing");

    buried();

    // If the top claim is unchanged, the layer is left untouched.
    expect(layers.cursor).toBe("grabbing");
    expect(layers.cursorLog).toEqual(["grab", "grabbing"]);
  });

  it("should not touch the layers when the top keeps its shape", () => {
    const { plot, layers } = mounted();

    plot.claimCursor("grab");
    const second = plot.claimCursor("grab");
    second();

    expect(layers.cursorLog).toEqual(["grab"]);
  });

  it("should make release idempotent", () => {
    const { plot, layers } = mounted();

    const hover = plot.claimCursor("grab");
    plot.claimCursor("grabbing");

    hover();
    hover(); // Calling it twice doesn't clear someone else's claim.

    expect(layers.cursor).toBe("grabbing");
  });

  it("should say the axes are grabbable", () => {
    const deps = testBrowserDeps();
    const { plot, layers } = mountPlot({
      deps,
      series: lineSeries(),
      data,
      config: {
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        showGrid: false,
      },
    });
    plot.render();
    const { area } = plot.mainPane;
    const route = (point: { x: number; y: number }) =>
      plot.routeInput({ type: "pointermove", point, pointerId: 1 });

    // Over the y-axis slice (default: left) — stretching is vertical, so the cursor is too.
    route({ x: area.left / 2, y: (area.top + area.bottom) / 2 });
    expect(layers.cursor).toBe("ns-resize");

    // Move into the plot area and the indicator clears.
    route({ x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 });
    expect(layers.cursor).toBeNull();

    // Over the x-axis slice — scaling is horizontal, so the cursor is too.
    route({ x: (area.left + area.right) / 2, y: area.bottom + 2 });
    expect(layers.cursor).toBe("ew-resize");
  });

  it("should touch the style only on transitions, and hold through a drag", () => {
    const deps = testBrowserDeps();
    const { plot, layers } = mountPlot({
      deps,
      series: lineSeries(),
      data,
      config: {
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        showGrid: false,
      },
    });
    plot.render();
    const { area } = plot.mainPane;
    const onAxis = { x: area.left / 2, y: (area.top + area.bottom) / 2 };
    const inPane = {
      x: (area.left + area.right) / 2,
      y: (area.top + area.bottom) / 2,
    };

    plot.routeInput({ type: "pointermove", point: onAxis, pointerId: 1 });
    plot.routeInput({
      type: "pointermove",
      point: { ...onAxis, y: onAxis.y + 5 },
      pointerId: 1,
    });
    // Moving within the same axis doesn't touch the style again.
    expect(layers.cursorLog).toEqual(["ns-resize"]);

    // Once a drag starts, the indicator holds even when dragged into the plot area.
    plot.routeInput({ type: "pointerdown", point: onAxis, pointerId: 1 });
    plot.routeInput({ type: "pointermove", point: inPane, pointerId: 1 });
    expect(layers.cursor).toBe("ns-resize");

    // Only after the drag ends and it moves in the plot area does it finally clear.
    plot.routeInput({ type: "pointerup", point: inPane, pointerId: 1 });
    plot.routeInput({ type: "pointermove", point: inPane, pointerId: 1 });
    expect(layers.cursor).toBeNull();
  });

  it("should stay harmless on a headless stage", () => {
    // In-memory layers have no setCursor — claims still stack, there's just no screen.
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
    });

    expect(() => {
      const release = model.plot.claimCursor("crosshair");
      release();
    }).not.toThrow();
  });
});
