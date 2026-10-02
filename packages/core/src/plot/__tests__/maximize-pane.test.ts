/**
 * A maximized pane is a layout mode the chart holds — the height split reads
 * the panes through it, and no pane's flex is written. What that buys: the
 * user's layout is untouched underneath, a pane added meanwhile collapses
 * and comes back at its own flex, and there is no snapshot to drift.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { ContractError } from "../../primitives";
import { lineSeries } from "../../series";
import type { PaneApi } from "../pane";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [{ x: 0, y: 1 }, { x: 10, y: 2 }];

/** A value from outside the type system. */
const junk = <T,>(json: string): T => JSON.parse(json);

/** Three panes on a 600px-tall chart, with the divider drag captured so a test can drive it. */
function stage(extra = 2) {
  const captured: { drag: ((index: number, dy: number) => void) | null } = { drag: null };
  const deps = testBrowserDeps({
    createDividers: (_overlay, onDrag) => {
      captured.drag = onDrag;
      return { render: () => undefined, clear: () => undefined, destroy: () => undefined };
    },
  });
  const { plot } = mountPlot({ deps, series: lineSeries(), data });
  const added = Array.from({ length: extra }, () => {
    const pane = plot.addPane();
    pane.addSeries({ series: lineSeries(), data });
    return pane;
  });
  plot.render();
  let rings = 0;
  plot.on("panesChange", () => rings++);
  const heights = (): number[] => {
    plot.render();
    return plot.panes.map((pane) => Math.round(pane.area.bottom - pane.area.top));
  };
  const drag = (index: number, dy: number): void => {
    if (!captured.drag) throw new Error("the divider wiring never received a drag callback");
    captured.drag(index, dy);
  };
  return { plot, added, heights, drag, rings: () => rings };
}

const flexes = (panes: readonly PaneApi[]): number[] => panes.map((pane) => pane.flex);

describe("maximizePane", () => {
  it("lets the pane fill the chart and lays the rest at their minHeight — without writing any flex", () => {
    const { plot, added, heights } = stage();
    const even = heights();

    plot.maximizePane(added[0]);

    const [main, target, other] = heights();
    expect(target).toBeGreaterThan(even[1] * 2);
    expect(main).toBe(plot.mainPane.minHeight);
    expect(other).toBe(added[1].minHeight);
    expect(flexes(plot.panes)).toEqual([1, 1, 1]);
    expect(plot.maximizedPane).toBe(added[0]);
  });

  it("gives the split back with null — the layout was never touched", () => {
    const { plot, added, heights } = stage();
    added[1].applyOptions({ flex: 2 });
    const before = heights();

    plot.maximizePane(added[0]);
    plot.maximizePane(null);

    expect(heights()).toEqual(before);
    expect(plot.maximizedPane).toBeNull();
  });

  it("rings panesChange once per change — a lone pane too, whose height doesn't move", () => {
    const { plot, rings } = stage(0);

    plot.maximizePane(plot.mainPane);
    plot.maximizePane(null);

    expect(rings()).toBe(2);
  });

  it("stays quiet when it names what is already there", () => {
    const { plot, added, rings } = stage();
    plot.maximizePane(null);
    plot.maximizePane(added[0]);
    const before = rings();

    plot.maximizePane(added[0]);

    expect(rings()).toBe(before);
  });

  it("refuses a pane that isn't on the chart, and changes nothing", () => {
    const { plot, added, rings } = stage();
    const foreign = mountPlot({ deps: testBrowserDeps(), series: lineSeries() }).plot.mainPane;

    expect(() => plot.maximizePane(foreign)).toThrow(ContractError);
    expect(() => plot.maximizePane(junk<PaneApi>("1"))).toThrow(ContractError);
    plot.removePane(added[1]);
    expect(() => plot.maximizePane(added[1])).toThrow(ContractError);

    expect(plot.maximizedPane).toBeNull();
    expect(rings()).toBe(1);
  });

  it("goes when the maximized pane is removed — the rest come back", () => {
    const { plot, added, heights, rings } = stage();
    const before = rings();
    plot.maximizePane(added[0]);

    plot.removePane(added[0]);

    expect(plot.maximizedPane).toBeNull();
    const [main, other] = heights();
    expect(main).toBe(other);
    // One for the maximize, one for the removal — the release rides along.
    expect(rings() - before).toBe(2);
  });

  it("holds when another pane is removed", () => {
    const { plot, added } = stage();
    plot.maximizePane(added[0]);

    plot.removePane(added[1]);

    expect(plot.maximizedPane).toBe(added[0]);
  });

  it("collapses a pane added meanwhile, which comes back at its own flex", () => {
    const { plot, added, heights } = stage();
    plot.maximizePane(added[0]);

    const late = plot.addPane({ flex: 3, minHeight: 30 });
    late.addSeries({ series: lineSeries(), data });

    expect(heights()[3]).toBe(30);
    plot.maximizePane(null);
    expect(late.flex).toBe(3);
    const [main, , , grown] = heights();
    expect(grown).toBeGreaterThan(main * 2);
  });

  it("keeps a flex set while maximized for when the split comes back", () => {
    const { plot, added, heights } = stage();
    plot.maximizePane(added[0]);
    const maximized = heights();

    added[1].applyOptions({ flex: 4 });

    // Still maximized — the flex is the split's, and the split isn't showing.
    expect(heights()).toEqual(maximized);
    plot.maximizePane(null);
    const [main, , grown] = heights();
    expect(grown).toBeGreaterThan(main * 3);
  });

  it("ends with a divider drag, whose heights become the panes' flex — one ring", () => {
    const { plot, added, heights, drag, rings } = stage();
    plot.maximizePane(added[0]);
    const shown = heights();
    const before = rings();

    // The divider between the target and the pane below it, dragged up 50px.
    drag(1, -50);

    expect(plot.maximizedPane).toBeNull();
    const after = heights();
    expect(after[1]).toBe(shown[1] - 50);
    expect(after[2]).toBe(shown[2] + 50);
    expect(rings() - before).toBe(1);
  });
});
