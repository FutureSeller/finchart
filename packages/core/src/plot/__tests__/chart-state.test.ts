import { afterEach, describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { barIndexX, LinearScale } from "../../scale";
import { manualScheduler } from "../../render";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDeps, testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import type { ChartState } from "../state";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function mounted() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({
    deps,
    series: lineSeries(),
    data,
  });

  const seen: ChartState[] = [];
  plot.on("stateChange", (state) => seen.push(state));

  return { plot, handle, xScale, yScale, layers, seen };
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

    // The domain is index [-0.5,4.5], but the state reports x [-0.5,6.5] — state speaks data x, not indices
    expect(plot.getState().xDomain).toEqual({ min: -0.5, max: 6.5 });
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
    const { plot, handle, seen } = mounted();
    // Three points follow their feed until they fill the screen; an explicit fit settles the window.
    plot.fitDomains();
    seen.length = 0;

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
    const { deps, xScale } = testBrowserDepsWithScales({ createXMapping: barIndexX });
    const { plot, handle } = mountPlot({ deps, series: candleSeries() });

    plot.applyState({ xDomain: { min: 1, max: 5 } });
    handle.setData(days);

    // x 1~5 covers bars 1~3 — a value that can only be counted once the data has arrived.
    expect(xScale.getDomain()).toEqual([1, 3]);
    expect(plot.getState().xDomain).toEqual({ min: 1, max: 5 });
  });

  it("should keep a manual value range restored before the data", () => {
    const { plot, handle } = mountPlot({ deps: testBrowserDeps(), series: lineSeries() });
    plot.applyState({ panes: [{ flex: 1, autoScale: false, valueDomain: { min: 0, max: 100 } }] });

    handle.setData(data);

    expect(plot.getState().panes[0]).toEqual({ flex: 1, autoScale: false, valueDomain: { min: 0, max: 100 } });
  });

  it("should validate every slice before applying any", () => {
    const { plot, seen } = mounted();
    plot.addPane();
    const before = plot.getState();

    expect(() => plot.applyState({
      xDomain: { min: 10, max: 20 },
      panes: [{ flex: 3, autoScale: true }, { flex: 1, autoScale: false, valueDomain: { min: 5, max: 1 } }],
    })).toThrow(/min\(5\) must be less than max\(1\)/);

    expect(plot.getState()).toEqual(before);
    expect(seen).toHaveLength(1);
  });

  it("should refuse a slice whose autoScale or invert is not a boolean", () => {
    const { plot } = mounted();
    // Hand-built state from a URL or storage — typed as anything.
    for (const slice of ['{"flex":1,"autoScale":"false"}', '{"flex":1,"autoScale":true,"invert":1}']) {
      expect(() => plot.applyState({ panes: [JSON.parse(slice)] })).toThrow(/must be a boolean/);
    }
    expect(plot.mainPane.autoScale).toBe(true);
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

  it("should pair unkeyed slices only when there is one for every pane", () => {
    const { plot } = mounted();

    // Two slices for one pane: which pane went away is unknowable without keys,
    // so none is guessed. Whoever creates panes (the wrapper) reapplies once the list matches.
    plot.applyState({
      panes: [
        { flex: 2, autoScale: true },
        { flex: 5, autoScale: true },
      ],
    });
    expect(plot.getState().panes).toEqual([{ flex: 1, autoScale: true }]);

    plot.addPane();
    plot.applyState({
      panes: [
        { flex: 2, autoScale: true },
        { flex: 5, autoScale: true },
      ],
    });
    expect(plot.getState().panes.map((pane) => pane.flex)).toEqual([2, 5]);
  });

  it("should not pair a saved unkeyed layout with panes after one was removed from the middle", () => {
    const { plot } = mounted();
    const middle = plot.addPane({ flex: 3 });
    plot.addPane({ flex: 7 });
    const saved = plot.getState();

    plot.removePane(middle);
    plot.applyState(saved);

    // Index pairing would have put the removed pane's 3 on the pane that was 7.
    expect(plot.getState().panes.map((pane) => pane.flex)).toEqual([1, 7]);
  });

  it("should treat a pre-fit snapshot as nothing to restore", () => {
    const { plot, seen } = mounted();

    plot.applyState({ xDomain: null });

    expect(seen).toHaveLength(0);
    expect(plot.getState().xDomain).toEqual({ min: 0, max: 100 });
  });

  it("should restore keyed panes by meaning after dynamic panes shift their positions", () => {
    const { plot } = mounted();
    plot.mainPane.applyOptions({ stateKey: "price", flex: 3, autoScale: false });
    plot.mainPane.setValueDomain(10, 90);
    const rsi = plot.addPane({ stateKey: "rsi", flex: 2, autoScale: false });
    rsi.setValueDomain(20, 80);
    const saved = plot.getState();

    const target = mounted();
    target.plot.mainPane.applyOptions({ stateKey: "price" });
    const volume = target.plot.addPane({ stateKey: "volume", flex: 7 });
    const targetRsi = target.plot.addPane({ stateKey: "rsi", flex: 1 });

    target.plot.applyState(saved);

    expect(target.plot.getState().panes).toEqual([
      { stateKey: "price", flex: 3, autoScale: false, valueDomain: { min: 10, max: 90 } },
      { stateKey: "volume", flex: 7, autoScale: true },
      { stateKey: "rsi", flex: 2, autoScale: false, valueDomain: { min: 20, max: 80 } },
    ]);
    expect(volume.flex).toBe(7);
    expect(targetRsi.flex).toBe(2);
  });

  it("should never apply an unkeyed legacy slice to a keyed pane", () => {
    const { plot } = mounted();
    plot.mainPane.applyOptions({ stateKey: "price", flex: 1 });
    const rsi = plot.addPane({ stateKey: "rsi", flex: 1 });

    plot.applyState({
      panes: [
        { flex: 9, autoScale: true },
        { stateKey: "rsi", flex: 4, autoScale: true },
      ],
    });

    expect(plot.mainPane.flex).toBe(1);
    expect(rsi.flex).toBe(4);
  });

  it("should reject duplicate or rewritten state keys", () => {
    const { plot } = mounted();
    plot.mainPane.applyOptions({ stateKey: "price" });

    expect(() => plot.addPane({ stateKey: "price" })).toThrow(/Duplicate pane stateKey/);
    expect(() => plot.mainPane.applyOptions({ stateKey: "other" })).toThrow(/cannot be changed/);
    expect(() =>
      plot.applyState({
        panes: [
          { stateKey: "rsi", flex: 1, autoScale: true },
          { stateKey: "rsi", flex: 1, autoScale: true },
        ],
      }),
    ).toThrow(/Duplicate pane stateKey/);
  });
});

describe("setValueDomain", () => {
  it("should survive streaming appends", () => {
    const { plot, handle, yScale } = mounted();

    // RSI's fixed 0~100 — the fixed-range use case now comes through the front door.
    plot.mainPane.setValueDomain(0, 100);
    handle.append([{ x: 150, y: 999 }]);

    expect(yScale.getDomain()).toEqual([0, 100]);
  });

  it("should yield to an explicit full fit", () => {
    const { plot, handle, yScale } = mounted();
    plot.mainPane.setValueDomain(0, 100);
    handle.append([{ x: 150, y: 999 }]);

    // "Fit everything" is a request — it refits a manual range too.
    plot.fitDomains();

    expect(yScale.getDomain()).not.toEqual([0, 100]);
  });

  it("should yield to an imperative setData", () => {
    const { plot, handle, yScale } = mounted();
    plot.mainPane.setValueDomain(0, 100);

    // A new dataset refits both axes
    handle.setData([{ x: 0, y: 500 }, { x: 10, y: 700 }]);

    expect(yScale.getDomain()).not.toEqual([0, 100]);
  });

  it("should survive the first data when set before it", () => {
    const { plot, handle } = mountPlot({ deps: testBrowserDeps(), series: lineSeries() });
    plot.mainPane.setValueDomain(0, 100);

    handle.setData(data);

    expect(plot.mainPane.yScale.getDomain()).toEqual([0, 100]);
  });

  it("should not outlive a hand-back to autoScale", () => {
    const { plot, handle } = mountPlot({ deps: testBrowserDeps(), series: lineSeries() });
    plot.mainPane.setValueDomain(0, 100);
    plot.mainPane.resetValueAxis();
    plot.mainPane.applyOptions({ autoScale: false });

    handle.setData(data);

    expect(plot.mainPane.yScale.getDomain()).not.toEqual([0, 100]);
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

/** The thrown value itself — `toThrow(error)` compares messages, not identity. */
function caught(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("fitDomains and the value axis mode", () => {
  it("an explicit fitDomains hands every pane back to autoScale — the axis follows the next bar", () => {
    const { plot, handle, yScale } = mounted();
    const second = plot.addPane();
    second.setValueDomain(0, 100);
    plot.mainPane.setValueDomain(0, 100);
    expect(plot.mainPane.autoScale).toBe(false);

    plot.fitDomains();
    expect(plot.mainPane.autoScale).toBe(true);
    expect(second.autoScale).toBe(true);

    // The axis follows what is visible again: bring the new bar into view and the range covers it.
    handle.append([{ x: 150, y: 999 }]);
    plot.setVisibleRange(0, 150);
    plot.render();
    expect(yScale.getDomain()[1]).toBeGreaterThanOrEqual(999);
  });

  it("an explicit fitDomains still fits x — the window you scrolled to is gone", () => {
    const { plot } = mounted();
    const whole = plot.getState().xDomain;
    plot.setVisibleRange(50, 60);
    expect(plot.getState().xDomain).not.toEqual(whole);
    plot.fitDomains();
    expect(plot.getState().xDomain).toEqual(whole);
  });

  it("rings stateChange once for the whole fit, and a listener that removes a pane does not hide the next one", () => {
    const { plot, seen } = mounted();
    const whole = plot.getState().xDomain;
    const a = plot.addPane();
    const b = plot.addPane();
    for (const pane of [plot.mainPane, a, b]) pane.setValueDomain(0, 100);
    // x narrowed too — the x fit inside must not ring on its own, ahead of the mode flips.
    plot.setVisibleRange(50, 60);
    const before = seen.length;
    // A mirror that, on seeing `a` follow the data again, drops the pane — the stack is `[main, a, b]`.
    plot.on("stateChange", () => {
      if (a.autoScale && plot.panes.includes(a)) plot.removePane(a);
    });

    plot.fitDomains();

    expect(plot.panes).toEqual([plot.mainPane, b]);
    expect(plot.mainPane.autoScale).toBe(true);
    expect(b.autoScale).toBe(true);
    // One for the fit (x and three panes together); the removal rings its own afterwards.
    expect(seen.length - before).toBe(2);
    const fit = seen[before];
    expect(fit?.xDomain).toEqual(whole);
    expect(fit?.panes.map((pane) => pane.autoScale)).toEqual([true, true, true]);
  });

  it("a listener that throws on the fit's notification does not undo the fit — every pane is reset and the error is the listener's own", () => {
    const { plot } = mounted();
    const a = plot.addPane();
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(0, 100);
    plot.setVisibleRange(50, 60);
    const boom = new Error("mirror failed");
    plot.on("stateChange", () => {
      throw boom;
    });

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(plot.mainPane.autoScale).toBe(true);
    expect(a.autoScale).toBe(true);
    expect(plot.getState().xDomain).not.toEqual({ min: 50, max: 60 });
  });

  it("a listener that throws mid-fit (xDomainChange) does not stop it — y is fitted and the panes reset, the error is still its own", () => {
    // A manual scheduler: nothing renders on its own, so what the fit did is all there is.
    const { deps, yScale } = testBrowserDepsWithScales({ createScheduler: manualScheduler() });
    const { plot } = mountPlot({ deps, series: lineSeries(), data });
    const whole = plot.getState().xDomain;
    const a = plot.addPane();
    // A manual range nowhere near the data: only the fit itself can move it before the next frame.
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(1000, 2000);
    plot.setVisibleRange(50, 60);
    const boom = new Error("x mirror failed");
    plot.on("xDomainChange", () => {
      throw boom;
    });

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(plot.getState().xDomain).toEqual(whole);
    // Before any render — the y fit ran despite the x listener.
    expect(yScale.getDomain()[1]).toBeLessThan(1000);
    expect(plot.mainPane.autoScale).toBe(true);
    expect(a.autoScale).toBe(true);
    plot.destroy();
  });

  it("every failure along the way comes out together, in order, after the one notification", () => {
    const { plot } = mounted();
    const a = plot.addPane();
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(0, 100);
    plot.setVisibleRange(50, 60);
    const xBoom = new Error("x");
    const paneBoom = new Error("pane");
    const stateBoom = new Error("state");
    let notified = 0;
    plot.on("xDomainChange", () => {
      throw xBoom;
    });
    a.subscribe((change) => {
      if (change.state) throw paneBoom;
    });
    plot.on("stateChange", () => {
      notified += 1;
      throw stateBoom;
    });

    const error = caught(() => plot.fitDomains());

    expect(error).toBeInstanceOf(AggregateError);
    const errors = error instanceof AggregateError ? error.errors : [];
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe(xBoom);
    expect(errors[1]).toBe(paneBoom);
    expect(errors[2]).toBe(stateBoom);
    expect(notified).toBe(1);
    expect(plot.mainPane.autoScale).toBe(true);
    expect(a.autoScale).toBe(true);
  });

  it("a pane subscriber that throws on its own reset does not stop the next pane's", () => {
    const { plot } = mounted();
    const a = plot.addPane();
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(0, 100);
    const boom = new Error("pane mirror failed");
    plot.mainPane.subscribe((change) => {
      if (change.state) throw boom;
    });

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(plot.mainPane.autoScale).toBe(true);
    expect(a.autoScale).toBe(true);
  });

  /** A value scale whose `setDomain` runs a hook once armed — the y fit's own collaborator, misbehaving. */
  class TrapScale extends LinearScale {
    hook: (() => void) | null = null;
    override setDomain(min: number, max: number): void {
      const hook = this.hook;
      this.hook = null;
      hook?.();
      super.setDomain(min, max);
    }
  }

  /** Three populated panes, all manual and far from the data, on a manual scheduler so only the fit can move them. */
  function threeManual() {
    const { deps } = testBrowserDepsWithScales({ createScheduler: manualScheduler() });
    const { plot } = mountPlot({ deps, series: lineSeries(), data });
    scheduled.push(plot);
    const a = plot.addPane();
    a.addSeries({ series: lineSeries(), data });
    const b = plot.addPane();
    b.addSeries({ series: lineSeries(), data });
    for (const pane of [plot.mainPane, a, b]) pane.setValueDomain(1000, 2000);
    return { plot, a, b };
  }
  afterEach(() => {
    for (const plot of scheduled.splice(0)) plot.destroy();
  });
  const scheduled: { destroy(): void }[] = [];
  const fitted = (pane: { yScale: { getDomain(): [number, number] } }) => pane.yScale.getDomain()[1] < 1000;

  it("a y fit that throws does not stop the other panes' fits — nor the resets, and the error is its own", () => {
    const { plot, a, b } = threeManual();
    const trap = new TrapScale();
    a.setYScale(trap);
    const boom = new Error("a's scale refused");
    trap.hook = () => {
      throw boom;
    };

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(fitted(plot.mainPane)).toBe(true);
    expect(fitted(b)).toBe(true);
    expect([plot.mainPane.autoScale, a.autoScale, b.autoScale]).toEqual([true, true, true]);
  });

  it("a y fit that removes a later pane — that pane is neither fitted nor reset, the rest are", () => {
    const { plot, a, b } = threeManual();
    const trap = new TrapScale();
    a.setYScale(trap);
    trap.hook = () => plot.removePane(b);

    plot.fitDomains();

    expect(plot.panes).toEqual([plot.mainPane, a]);
    expect(fitted(plot.mainPane)).toBe(true);
    expect(fitted(a)).toBe(true);
    expect(b.yScale.getDomain()).toEqual([1000, 2000]);
    expect(b.autoScale).toBe(false);
    expect([plot.mainPane.autoScale, a.autoScale]).toEqual([true, true]);
  });

  it("a pane subscriber that removes panes during the reset — survivors reset, the removed ones are left alone", () => {
    const { plot } = mounted();
    const a = plot.addPane();
    const b = plot.addPane();
    const c = plot.addPane();
    for (const pane of [plot.mainPane, a, b, c]) pane.setValueDomain(0, 100);
    // On its own reset, `a` takes itself and `c` off the chart — `b` must still be reached, `c` must not.
    a.subscribe((change) => {
      if (change.state && a.autoScale) {
        plot.removePane(a);
        plot.removePane(c);
      }
    });

    plot.fitDomains();

    expect(plot.panes).toEqual([plot.mainPane, b]);
    expect(plot.mainPane.autoScale).toBe(true);
    expect(b.autoScale).toBe(true);
    expect(c.autoScale).toBe(false);
  });

  it("the fit data changes take keeps a manual mode — setData refits the range, not the mode", () => {
    const { plot, handle, yScale } = mounted();
    const second = plot.addPane();
    second.setValueDomain(0, 100);
    plot.mainPane.setValueDomain(0, 100);

    handle.setData([
      { x: 0, y: 500 },
      { x: 50, y: 600 },
    ]);
    expect(yScale.getDomain()).not.toEqual([0, 100]);
    expect(plot.mainPane.autoScale).toBe(false);
    expect(second.autoScale).toBe(false);
    expect(second.yScale.getDomain()).toEqual([0, 100]);
  });

  it("the first data keeps a manual mode set before it", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineSeries() });
    plot.mainPane.setValueDomain(0, 100);
    plot.mainPane.addSeries({ series: lineSeries(), data });
    expect(plot.mainPane.autoScale).toBe(false);
  });
});
