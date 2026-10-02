/**
 * The maximize toggle and its gestures. The layout itself — what fills the
 * chart, what a removal or a divider drag does to it — is the chart's
 * (`plot/__tests__/maximize-pane.test.ts`); here: the plugin drives it, the
 * same pane twice toggles off, a stale pane is refused, and no flex is ever
 * written.
 */
import { describe, expect, it } from "vitest";
import { lineSeries } from "../../series";
import { paneMaximize } from "../pane-maximize";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "../../plot/__tests__/helpers";
import { ContractError } from "../../primitives";

/** A value from outside the type system — the way storage hands it over. */
const junk = <T,>(json: string): T => JSON.parse(json);

function setup(panes = 3) {
  const deps = testBrowserDeps();
  const { plot, handle } = mountPlot({
    deps,
    series: lineSeries(),
    config: defaultConfig,
  });
  // Without a dataRange, render() bails out early with no layout — the
  // gesture tests hit-test against pane.area, so data must be filled in.
  handle.setData([
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ]);
  const added = Array.from({ length: panes }, () => {
    const pane = plot.addPane();
    pane.addSeries(lineSeries());
    return pane;
  });
  plot.render();
  return { plot, added };
}

describe("paneMaximize", () => {
  it("maximizes through the chart, writing no flex", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);

    expect(plot.maximizedPane).toBe(added[1]);
    expect(max.maximizedPane).toBe(added[1]);
    expect(plot.panes.map((pane) => pane.flex)).toEqual([1, 1, 1, 1]);
  });

  it("refuses a pane that is no longer on the chart, leaving the layout alone", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    plot.removePane(added[0]);

    expect(() => max.maximize(added[0])).toThrow(/pane of this chart/);

    expect(plot.maximizedPane).toBeNull();
  });

  it("refuses calls after it was disposed", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    max.dispose();

    expect(() => max.maximize(added[1])).toThrow(/disposed/);
    expect(() => max.restore()).toThrow(/disposed/);
    expect(plot.maximizedPane).toBeNull();
  });

  it("gives the split back on restore", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);
    max.restore();

    expect(plot.maximizedPane).toBeNull();
  });

  it("toggles off when the same pane is maximized twice, and moves to another without restoring", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    let rings = 0;
    plot.on("panesChange", () => rings++);

    max.maximize(added[0]);
    max.maximize(added[1]);
    expect(max.maximizedPane).toBe(added[1]);
    max.maximize(added[1]);

    expect(max.maximizedPane).toBeNull();
    // One ring per change: maximize, move, toggle off.
    expect(rings).toBe(3);
  });

  it("follows a maximize made on the chart directly", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());

    plot.maximizePane(added[2]);

    expect(max.maximizedPane).toBe(added[2]);
    max.maximize(added[2]);
    expect(plot.maximizedPane).toBeNull();
  });

  it("leaves the layout as it is on dispose", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    max.maximize(added[0]);

    max.dispose();

    expect(plot.maximizedPane).toBe(added[0]);
  });

  it("refuses a gestures flag that is not a boolean — \"false\" from storage is truthy", () => {
    expect(() => paneMaximize({ gestures: junk<boolean>('"false"') })).toThrow(ContractError);
  });

  it("survives plot.destroy without a manual dispose", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    max.maximize(added[0]);

    expect(() => plot.destroy()).not.toThrow();
  });
});

/**
 * Escape is on by default since it has no owner overlapping with
 * doubleClickReset, but double-clicking a pane occupies the same slot as
 * `doubleClickReset` (default true) — it needs an explicit opt-in.
 */
describe("paneMaximize gestures", () => {
  function pointOf(pane: { area: { left: number; right: number; top: number; bottom: number } }) {
    const { area } = pane;
    return { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  }

  it("does not consume double-click by default", () => {
    const { plot, added } = setup();
    plot.use(paneMaximize());

    // Must be false for pointer.ts to continue on to doubleClick()/fitDomains().
    expect(plot.routeInput({ type: "dblclick", point: pointOf(added[0]) })).toBe(
      false,
    );
  });

  it("toggles the pane under the cursor when gestures: true", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize({ gestures: true }));

    const consumed = plot.routeInput({
      type: "dblclick",
      point: pointOf(added[1]),
    });

    expect(consumed).toBe(true);
    expect(max.maximizedPane).toBe(added[1]);
  });

  it("restores with Escape regardless of the gestures option", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    max.maximize(added[0]);

    const consumed = plot.routeInput({ type: "keydown", key: "Escape" });

    expect(consumed).toBe(true);
    expect(max.maximizedPane).toBeNull();
  });

  it("lets Escape pass through the stack when nothing is maximized", () => {
    const { plot } = setup();
    plot.use(paneMaximize());

    expect(plot.routeInput({ type: "keydown", key: "Escape" })).toBe(false);
  });
});
