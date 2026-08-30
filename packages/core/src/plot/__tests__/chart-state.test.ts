import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { barIndexX } from "../../scale";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { ChartState } from "../state";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function mounted() {
  const deps = testBrowserDeps();
  const { plot, handle, layers } = mountPlot({
    deps,
    series: lineSeries(),
    data,
  });

  const seen: ChartState[] = [];
  plot.on("stateChange", (state) => seen.push(state));

  return { plot, handle, deps, layers, seen };
}

describe("getState", () => {

  it("should have no xDomain before the first fit", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineSeries() });

    // The scale's default [0,1] is not state the user created.
    expect(plot.getState()).toEqual({
      xDomain: null,
      panes: [{ flex: 1, autoScale: true }],
    });
  });

  it("should read the visible x span in data x", () => {
    const { plot } = mounted();

    expect(plot.getState().xDomain).toEqual({ min: 0, max: 100 });
  });

  it("should speak data x even in bar-index mode", () => {
    const days: OHLC[] = [0, 1, 2, 5, 6].map((x) => ({
      x,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
    }));
    const deps = testBrowserDeps({ createXMapping: barIndexX });
    const { plot } = mountPlot({ deps, series: candleSeries(), data: days });

    // The domain is index [0,4], but the state reports x [0,6] — state speaks data x, not indices
    expect(plot.getState().xDomain).toEqual({ min: 0, max: 6 });
  });

  it("should carry the manual value domain only when autoScale is off", () => {
    const { plot } = mounted();
    expect(plot.getState().panes[0].valueDomain).toBeUndefined();

    plot.mainPane.applyOptions({ autoScale: false });

    const pane = plot.getState().panes[0];
    expect(pane.autoScale).toBe(false);
    expect(pane.valueDomain).toBeDefined();
  });
});

describe("stateChange", () => {
  it("should fire on pan with the new xDomain", () => {
    const { plot, seen } = mounted();

    plot.pan(10);

    expect(seen.at(-1)?.xDomain).toEqual({ min: 10, max: 110 });
  });

  it("should fire when a pane option changes a state slice", () => {
    const { plot, seen } = mounted();

    plot.mainPane.applyOptions({ autoScale: false });

    expect(seen).toHaveLength(1);
    expect(seen[0].panes[0].autoScale).toBe(false);
  });

  it("should stay quiet when the option merely restates the state", () => {
    const { plot, seen } = mounted();

    // Restating the same value is not a state change — React pushing the
    // same options on every render must not spin the mirror for nothing.
    plot.mainPane.applyOptions({ flex: 1, autoScale: true });
    // Options that aren't state slices stay quiet too.
    plot.mainPane.applyOptions({ minHeight: 60 });

    expect(seen).toHaveLength(0);
  });

  it("should stay quiet on data growth", () => {
    const { handle, seen } = mounted();

    // Data isn't state, and append doesn't touch the domain either.
    handle.append([{ x: 150, y: 30 }]);
    handle.prepend([{ x: -50, y: 5 }]);

    expect(seen).toHaveLength(0);
  });

  it("should report the grown pane list when a pane is added", () => {
    const { plot, seen } = mounted();

    plot.addPane({ flex: 2 });

    expect(seen.at(-1)?.panes.map((pane) => pane.flex)).toEqual([1, 2]);
  });

  it("should fire when a divider drag reshapes the panes", () => {
    // The DOM divider moved to @finchart/dom — what's tested here is the
    // core wiring by which a drag callback reaches the state event, so a
    // fake divider that just captures the callback is enough.
    const captured: {
      drag: ((index: number, dy: number) => void) | null;
    } = { drag: null };
    const deps = testBrowserDeps({
      createDividers: (_overlay, onDrag) => {
        captured.drag = onDrag;
        return {
          render: () => undefined,
          clear: () => undefined,
          destroy: () => undefined,
        };
      },
    });
    const { plot } = mountPlot({ deps, series: lineSeries(), data });
    const seen: ChartState[] = [];
    plot.on("stateChange", (state) => seen.push(state));
    plot.addPane();
    plot.render();

    if (!captured.drag) throw new Error("the divider wiring never received a drag callback");
    captured.drag(0, 40);

    const panes = seen.at(-1)?.panes ?? [];
    // The top pane grew by 40px — flex is frozen as a pixel height -> resizeBetween
    expect(panes[0].flex).toBeGreaterThan(panes[1].flex);
  });
});

describe("applyState", () => {
  it("should round trip through getState", () => {
    const { plot } = mounted();
    plot.pan(10);
    const saved = plot.getState();

    const restored = mounted();
    restored.plot.applyState(saved);

    expect(restored.plot.getState()).toEqual(saved);
  });

  it("should only touch the slices it was given", () => {
    const { plot } = mounted();
    plot.mainPane.applyOptions({ flex: 3 });

    plot.applyState({ xDomain: { min: 20, max: 60 } });

    expect(plot.getState().panes[0].flex).toBe(3);
    expect(plot.getState().xDomain).toEqual({ min: 20, max: 60 });
  });

  it("should hold a restore that arrives before the data", () => {
    const deps = testBrowserDeps();
    const { plot, handle } = mountPlot({ deps, series: lineSeries() });

    // The real order for URL restoration — state first, data second.
    plot.applyState({ xDomain: { min: 10, max: 50 } });
    handle.setData(data);

    // The first data's fit must not overwrite the restored window.
    expect(plot.getState().xDomain).toEqual({ min: 10, max: 50 });
  });

  it("should land the held restore in index space for bar-index", () => {
    const days: OHLC[] = [0, 1, 2, 5, 6].map((x) => ({
      x,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
    }));
    const deps = testBrowserDeps({ createXMapping: barIndexX });
    const { plot, handle } = mountPlot({ deps, series: candleSeries() });

    plot.applyState({ xDomain: { min: 1, max: 5 } });
    handle.setData(days);

    // x 1~5 covers bars 1~3 — a value that can only be counted once the data has arrived.
    expect(deps.xScale.getDomain()).toEqual([1, 3]);
    expect(plot.getState().xDomain).toEqual({ min: 1, max: 5 });
  });

  it("should apply pane slices and notify once", () => {
    const { plot, seen } = mounted();
    plot.addPane();
    seen.length = 0;

    plot.applyState({
      panes: [
        { flex: 3, autoScale: true },
        { flex: 1, autoScale: false, valueDomain: { min: 0, max: 100 } },
      ],
    });

    expect(seen).toHaveLength(1);
    expect(plot.getState().panes).toEqual([
      { flex: 3, autoScale: true },
      { flex: 1, autoScale: false, valueDomain: { min: 0, max: 100 } },
    ]);
  });

  it("should drop slices for panes that do not exist yet", () => {
    const { plot } = mounted();

    // Whoever creates panes (the wrapper) reapplies when the list changes — here it's dropped.
    plot.applyState({
      panes: [
        { flex: 2, autoScale: true },
        { flex: 5, autoScale: true },
      ],
    });

    expect(plot.getState().panes).toEqual([{ flex: 2, autoScale: true }]);
  });

  it("should treat a pre-fit snapshot as nothing to restore", () => {
    const { plot, seen } = mounted();

    plot.applyState({ xDomain: null });

    expect(seen).toHaveLength(0);
    expect(plot.getState().xDomain).toEqual({ min: 0, max: 100 });
  });
});

describe("setValueDomain", () => {
  it("should survive streaming appends", () => {
    const { plot, handle, deps } = mounted();

    // RSI's fixed 0~100 — the fixed-range use case now comes through the front door.
    plot.mainPane.setValueDomain(0, 100);
    handle.append([{ x: 150, y: 999 }]);

    expect(deps.mainPaneYScale.getDomain()).toEqual([0, 100]);
  });

  it("should yield to an explicit full fit", () => {
    const { plot, handle, deps } = mounted();
    plot.mainPane.setValueDomain(0, 100);
    handle.append([{ x: 150, y: 999 }]);

    // "Fit everything" is a request — it refits a manual range too.
    plot.fitDomains();

    expect(deps.mainPaneYScale.getDomain()).not.toEqual([0, 100]);
  });

  it("should yield to an imperative setData", () => {
    const { plot, handle, deps } = mounted();
    plot.mainPane.setValueDomain(0, 100);

    // A new dataset refits both axes
    handle.setData([{ x: 0, y: 500 }, { x: 10, y: 700 }]);

    expect(deps.mainPaneYScale.getDomain()).not.toEqual([0, 100]);
  });

  it("should announce itself as a state change", () => {
    const { plot, seen } = mounted();

    plot.mainPane.setValueDomain(0, 100);

    expect(seen.at(-1)?.panes[0]).toEqual({
      flex: 1,
      autoScale: false,
      valueDomain: { min: 0, max: 100 },
    });
  });
});
