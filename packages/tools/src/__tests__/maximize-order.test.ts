/**
 * **A drawing comes before the layout.** `paneMaximize` and the drawing
 * tools both answer Esc and double-click; at the same priority the one
 * installed later went first, so whether Esc cancelled the line being
 * drawn or restored the panes depended on JSX order. The maximize
 * gestures only take what nothing on the chart claimed.
 */
import { describe, expect, it } from "vitest";
import { createPlotModel, lineSeries, paneMaximize } from "@finchart/core";
import { drawingTools } from "../tools";

const mount = () => {
  const model = createPlotModel({
    size: { width: 600, height: 400 },
    series: {
      series: lineSeries(),
      data: [
        { x: 0, y: 10 },
        { x: 100, y: 20 },
      ],
    },
  });
  const { plot } = model;
  const tools = plot.mainPane.use(drawingTools({ plot }));
  // Installed after the tools — the order that used to put it in front.
  const max = plot.use(paneMaximize({ gestures: true }));
  plot.render();
  return { plot, tools, max };
};

describe("paneMaximize under the drawing tools", () => {
  it("lets Esc cancel the drawing in progress before restoring the panes", () => {
    const { plot, tools, max } = mount();
    max.maximize(plot.mainPane);
    tools.begin("trend");

    expect(plot.routeInput({ type: "keydown", key: "Escape" })).toBe(true);
    expect(tools.mode()).toBeNull();
    expect(max.maximizedPane).toBe(plot.mainPane);

    expect(plot.routeInput({ type: "keydown", key: "Escape" })).toBe(true);
    expect(max.maximizedPane).toBeNull();
  });

  it("selects a drawing double-clicked instead of maximizing its pane", () => {
    const { plot, tools, max } = mount();
    tools.add({ type: "horizontal", price: 15 });
    plot.render();
    const point = { x: plot.pixelAtX(50), y: plot.mainPane.yScale.scale(15) };

    expect(plot.routeInput({ type: "dblclick", point })).toBe(true);
    expect(tools.selection()).not.toBeNull();
    expect(max.maximizedPane).toBeNull();
  });
});
