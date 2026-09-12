import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A point on the y-axis strip beside the main pane (the axis sits on the left by default), and one inside the pane. */
function points(plot: ReturnType<typeof mountPlot>["plot"]) {
  plot.render();
  const { area } = plot.mainPane;
  const y = (area.top + area.bottom) / 2;
  return { axis: { x: area.left - 2, y }, pane: { x: (area.left + area.right) / 2, y } };
}

function setup(axisDrag = true) {
  const { plot } = mountPlot({
    deps: testBrowserDeps(),
    series: lineSeries(),
    data,
    config: { showGrid: false, axisDrag },
  });
  const second = plot.addPane();
  const seen: string[] = [];
  plot.on("dblclick", () => seen.push("dblclick"));
  return { plot, second, seen };
}

describe("a double-click on the y axis", () => {
  it("hands that pane's axis back to autoScale and is consumed — the other pane and the public event untouched", () => {
    const { plot, second, seen } = setup();
    plot.mainPane.setValueDomain(0, 100);
    second.setValueDomain(0, 100);

    const { axis } = points(plot);
    expect(plot.routeInput({ type: "dblclick", point: axis })).toBe(true);

    expect(plot.mainPane.autoScale).toBe(true);
    expect(second.autoScale).toBe(false);
    expect(seen).toEqual([]);
  });

  it("resets the pane under the pointer, not the main one — and leaves x where it was", () => {
    const { plot, second, seen } = setup();
    plot.mainPane.setValueDomain(0, 100);
    second.setValueDomain(0, 100);
    plot.setVisibleRange(50, 60);
    plot.render();
    const { area } = second;
    const beside = { x: area.left - 2, y: (area.top + area.bottom) / 2 };

    expect(plot.routeInput({ type: "dblclick", point: beside })).toBe(true);

    expect(second.autoScale).toBe(true);
    expect(plot.mainPane.autoScale).toBe(false);
    expect(plot.getState().xDomain).toEqual({ min: 50, max: 60 });
    expect(seen).toEqual([]);
  });

  it("inside the pane it is nobody's — the whole-chart reset path stays open", () => {
    const { plot } = setup();
    plot.mainPane.setValueDomain(0, 100);
    const { pane } = points(plot);
    expect(plot.routeInput({ type: "dblclick", point: pane })).toBe(false);
    expect(plot.mainPane.autoScale).toBe(false);
  });

  it("is no gesture at all when axisDrag is off", () => {
    const { plot } = setup(false);
    plot.mainPane.setValueDomain(0, 100);
    const { axis } = points(plot);
    expect(plot.routeInput({ type: "dblclick", point: axis })).toBe(false);
    expect(plot.mainPane.autoScale).toBe(false);
  });
});
