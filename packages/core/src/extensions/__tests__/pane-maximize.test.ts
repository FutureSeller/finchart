/**
 * Pane maximize/restore. Four things it must hold: collapsing sets
 * flex 0 (never invents some large flex), calling it again on the same
 * pane toggles it off, an outside change to flex (e.g. a divider drag)
 * discards the snapshot without restoring, and if the target pane is
 * removed only the surviving panes are restored.
 */
import { describe, expect, it } from "vitest";
import { lineSeries } from "../../series";
import { paneMaximize } from "../pane-maximize";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "../../plot/__tests__/helpers";

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
  it("collapses every pane but the target to flex 0", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);

    expect(plot.mainPane.flex).toBe(0);
    expect(added[0].flex).toBe(0);
    expect(added[1].flex).toBe(1); // the target leaves its own flex alone — nothing invented
    expect(added[2].flex).toBe(0);
    expect(max.maximizedPane).toBe(added[1]);
  });

  it("restores every pane's original flex", () => {
    const { plot, added } = setup();
    plot.mainPane.applyOptions({ flex: 2 });
    added[0].applyOptions({ flex: 0.5 });
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);
    max.restore();

    expect(plot.mainPane.flex).toBe(2);
    expect(added[0].flex).toBe(0.5);
    expect(added[1].flex).toBe(1);
    expect(added[2].flex).toBe(1);
    expect(max.maximizedPane).toBeNull();
  });

  it("toggles off when the same pane is maximized twice", () => {
    const { plot, added } = setup();
    added[0].applyOptions({ flex: 0.4 });
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);
    max.maximize(added[1]);

    expect(max.maximizedPane).toBeNull();
    expect(added[0].flex).toBe(0.4);
  });

  it("replaces the target without restoring in between", () => {
    const { plot, added } = setup();
    plot.mainPane.applyOptions({ flex: 3 });
    const max = plot.use(paneMaximize());

    max.maximize(added[0]);
    max.maximize(added[1]);

    expect(added[0].flex).toBe(0);
    expect(added[1].flex).toBe(1);
    expect(max.maximizedPane).toBe(added[1]);

    max.restore();
    // The first snapshot (mainPane flex 3) survived through the swap.
    expect(plot.mainPane.flex).toBe(3);
  });

  it("discards the snapshot when flex changes from outside (e.g. a divider drag)", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    max.maximize(added[1]);

    // Simulates a divider drag — an outside change directly to another
    // pane's flex.
    added[0].applyOptions({ flex: 0.6 });

    expect(max.maximizedPane).toBeNull();
    // The value the user just set stays as-is — we never revert it.
    expect(added[0].flex).toBe(0.6);
  });

  it("auto-restores survivors when the maximized pane is removed", () => {
    const { plot, added } = setup();
    plot.mainPane.applyOptions({ flex: 2 });
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);
    plot.removePane(added[1]);

    expect(max.maximizedPane).toBeNull();
    expect(plot.mainPane.flex).toBe(2);
    expect(added[0].flex).toBe(1);
    expect(added[2].flex).toBe(1);
  });

  it("keeps maximizing when a pane other than the target is removed", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());

    max.maximize(added[1]);
    plot.removePane(added[2]);

    expect(max.maximizedPane).toBe(added[1]);
    expect(plot.mainPane.flex).toBe(0);
  });

  it("returns null from serialize when nothing is maximized", () => {
    const { plot } = setup();
    const max = plot.use(paneMaximize());
    expect(max.serialize()).toBeNull();
  });

  it("round-trips through serialize/load", () => {
    const { plot, added } = setup();
    plot.mainPane.applyOptions({ flex: 2 });
    const max = plot.use(paneMaximize());
    max.maximize(added[1]);

    const payload = max.serialize();
    expect(payload).not.toBeNull();
    max.restore();

    const loaded = plot.use(paneMaximize());
    const ok = loaded.load(payload!);

    expect(ok).toBe(true);
    expect(loaded.maximizedPane).toBe(added[1]);
    expect(plot.mainPane.flex).toBe(0);
    expect(added[0].flex).toBe(0);

    loaded.restore();
    expect(plot.mainPane.flex).toBe(2);
  });

  it("rejects garbage or foreign-shaped payloads without throwing", () => {
    const { plot } = setup();
    const max = plot.use(paneMaximize());

    expect(max.load("not json")).toBe(false);
    expect(max.load(JSON.stringify({ version: 999, targetIndex: 0, flex: [] }))).toBe(
      false,
    );
    expect(max.load(JSON.stringify({ version: 1, targetIndex: 99, flex: [] }))).toBe(
      false,
    );
  });

  /**
   * The parser rejects a negative flex too — without that guard, `load`
   * could plant the snapshot, then throw partway through collapsing the
   * earlier panes, or end up with a half-applied layout where
   * `maximizedPane` still claims success. This function's contract is
   * "unreadable means false — never throw," so throwing isn't allowed
   * either.
   */
  it("rejects a negative flex without throwing or half-applying", () => {
    const { plot, added } = setup();
    const max = plot.use(paneMaximize());
    const before = [plot.mainPane.flex, ...added.map((pane) => pane.flex)];

    let result: unknown;
    expect(() => {
      result = max.load(
        JSON.stringify({ version: 1, targetIndex: 1, flex: [1, -2, 1] }),
      );
    }).not.toThrow();

    expect(result).toBe(false);
    expect(max.maximizedPane).toBeNull();
    // The layout must come out completely untouched — a half-applied
    // result is the worst possible outcome.
    expect([plot.mainPane.flex, ...added.map((pane) => pane.flex)]).toEqual(
      before,
    );
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
