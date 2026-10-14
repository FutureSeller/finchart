/**
 * **A drawing comes before the layout.** `paneMaximize` and the drawing
 * tools both answer Esc and double-click; at the same priority the one
 * installed later goes first, so whether Esc cancels the line being
 * drawn or restores the panes would depend on JSX order. The maximize
 * gestures only take what nothing on the chart claimed.
 */
import { describe, expect, it } from "vitest";
import { lineSeries, paneMaximize } from "@finchart/core";
import { drawingChart } from "./drawing-chart.fixture";

const mount = () => {
  const chart = drawingChart({
    series: {
      series: lineSeries(),
      data: [
        { x: 0, y: 10 },
        { x: 100, y: 20 },
      ],
    },
  });
  // Installed after the tools — the order that wins a tie.
  const max = chart.plot.use(paneMaximize({ gestures: true }));
  return { ...chart, max };
};

describe("paneMaximize under the drawing tools", () => {
  it("lets Esc cancel the drawing in progress before restoring the panes", () => {
    const { plot, tools, max, key } = mount();
    max.maximize(plot.mainPane);
    tools.begin("trend");

    expect(key("Escape")).toBe(true);
    expect(tools.mode()).toBeNull();
    expect(max.maximizedPane).toBe(plot.mainPane);

    expect(key("Escape")).toBe(true);
    expect(max.maximizedPane).toBeNull();
  });

  it("selects a drawing double-clicked instead of maximizing its pane", () => {
    const { plot, tools, max, dblclick } = mount();
    tools.add({ type: "horizontal", price: 15 });
    plot.render();

    expect(dblclick({ x: 50, price: 15 })).toBe(true);
    expect(tools.selection()).not.toBeNull();
    expect(max.maximizedPane).toBeNull();
  });
});

describe("the toolbox's input priority", () => {
  it("defaults to the router's default of 0 when left out", () => {
    const { plot, tools, key } = drawingChart();
    const asked: string[] = [];
    const consumer = (name: string) => ({
      handle: () => {
        asked.push(name);
        return false;
      },
    });
    // A tie goes to the later registration, so a default consumer added
    // now is asked first; one just below the default is never reached.
    plot.addInputConsumer(consumer("below"), { priority: -1 });
    plot.addInputConsumer(consumer("default"));
    tools.begin("trend");

    expect(key("Escape")).toBe(true);
    expect(tools.mode()).toBeNull();
    expect(asked).toEqual(["default"]);
  });
});
