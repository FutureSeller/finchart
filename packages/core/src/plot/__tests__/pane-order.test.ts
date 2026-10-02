/** `setPaneOrder` — a host that owns the pane layout (a JSX tree) puts panes where it declares them. */
import { describe, expect, it } from "vitest";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { ContractError } from "../../primitives";
import { lineSeries } from "../../series";
import { mountPlot } from "./helpers";

function mount() {
  const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
  const rsi = plot.addPane({ flex: 2 });
  const macd = plot.addPane({ flex: 3 });
  // What a follower reads when `panesChange` rings — the event carries no payload.
  const states: number[][] = [];
  plot.on("panesChange", () => states.push(plot.panes.map((pane) => pane.flex)));
  return { plot, rsi, macd, states };
}

describe("setPaneOrder", () => {
  it("stacks the panes in the given order, main pane included, and says so once", () => {
    const { plot, rsi, macd, states } = mount();

    plot.setPaneOrder([macd, plot.mainPane, rsi]);

    expect(plot.panes).toEqual([macd, plot.mainPane, rsi]);
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual([3, 1, 2]);
  });

  it("does nothing when the order is unchanged", () => {
    const { plot, rsi, macd, states } = mount();

    plot.setPaneOrder([plot.mainPane, rsi, macd]);

    expect(states).toHaveLength(0);
  });

  it("refuses anything but a reordering of the chart's own panes", () => {
    const { plot, rsi, macd } = mount();
    const other = mountPlot({ deps: testBrowserDeps() }).plot.mainPane;

    for (const order of [[rsi, macd], [plot.mainPane, rsi, rsi], [plot.mainPane, rsi, other]]) {
      expect(() => plot.setPaneOrder(order)).toThrow(ContractError);
    }
    expect(plot.panes).toEqual([plot.mainPane, rsi, macd]);
  });
});
