import { afterEach, describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { barIndexX, LinearScale, LogScale } from "../../scale";
import { manualScheduler } from "../../render";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDeps, testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

interface PaneLayout {
  flex: number;
  autoScale: boolean;
}

/** What a follower reads when `panesChange` rings — the event carries no payload. */
function layoutOf(plot: { panes: readonly { flex: number; autoScale: boolean }[] }): PaneLayout[] {
  return plot.panes.map(({ flex, autoScale }) => ({ flex, autoScale }));
}

function mounted() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({
    deps,
    series: lineSeries(),
    data,
  });

  const seen: PaneLayout[][] = [];
  plot.on("panesChange", () => seen.push(layoutOf(plot)));

  return { plot, handle, xScale, yScale, layers, seen };
}

describe("getVisibleRange", () => {

  it("should be null before the first fit", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineSeries() });

    // The scale's default [0,1] is not a window anyone chose.
    expect(plot.getVisibleRange()).toBeNull();
  });

  it("should read the visible x span in data x", () => {
    const { plot } = mounted();

    expect(plot.getVisibleRange()).toEqual({ min: 0, max: 100 });
  });

  it("should keep a window set before the data over the offset fit", () => {
    const { plot, handle } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: { rightOffset: 10 } });
    plot.setVisibleRange(10, 60);

    handle.setData(data);

    expect(plot.getVisibleRange()).toEqual({ min: 10, max: 60 });
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

    // The domain is index [-0.5,4.5], but the range reads x [-0.5,6.5] — data x, not indices
    expect(plot.getVisibleRange()).toEqual({ min: -0.5, max: 6.5 });
  });
});

describe("panesChange", () => {
  it("should stay quiet on pan — the x window has its own event", () => {
    const { plot, seen } = mounted();

    plot.pan(10);

    expect(plot.getVisibleRange()).toEqual({ min: 10, max: 110 });
    expect(seen).toHaveLength(0);
  });

  it("should fire when a pane's minHeight changes — it is layout", () => {
    const { plot, seen } = mounted();

    plot.mainPane.applyOptions({ minHeight: 60 });

    expect(seen).toHaveLength(1);
  });

  it("should fire when a pane setting changes", () => {
    const { plot, seen } = mounted();

    plot.mainPane.applyOptions({ autoScale: false });

    expect(seen).toHaveLength(1);
    expect(seen[0][0].autoScale).toBe(false);
  });

  it("should stay quiet when the option merely restates the setting", () => {
    const { plot, seen } = mounted();

    // Restating the same value is not a change — React pushing the same
    // options on every render must not spin a follower for nothing.
    plot.mainPane.applyOptions({ flex: 1, autoScale: true });
    // How a pane draws isn't its layout or its axis mode — those stay quiet too.
    plot.mainPane.applyOptions({ valuePadding: 0.3, axis: { showLabels: false } });

    expect(seen).toHaveLength(0);
  });

  it("should stay quiet on data growth", () => {
    const { plot, handle, seen } = mounted();
    // Three points follow their feed until they fill the screen; an explicit fit settles the window.
    plot.fitDomains();
    seen.length = 0;

    // Data isn't a pane change.
    handle.append([{ x: 150, y: 30 }]);
    handle.prepend([{ x: -50, y: 5 }]);

    expect(seen).toHaveLength(0);
  });

  it("should report the grown pane list when a pane is added", () => {
    const { plot, seen } = mounted();

    plot.addPane({ flex: 2 });

    expect(seen.at(-1)?.map((pane) => pane.flex)).toEqual([1, 2]);
  });

  it("should fire when a divider drag reshapes the panes", () => {
    const { plot, drag, seen } = dragging();

    drag(0, 40);

    // One for the added pane, one for the drag — the drag rewrites both
    // panes' flex, and runs on every pointermove, so it rings once, not per pane.
    expect(seen).toHaveLength(2);
    const panes = seen.at(-1) ?? [];
    // The top pane grew by 40px — flex is frozen as a pixel height -> resizeBetween
    expect(panes[0].flex).toBeGreaterThan(panes[1].flex);
    expect(layoutOf(plot)).toEqual(panes);
  });

  it("should still announce a drag that a pane subscriber broke off part-way", () => {
    const { plot, drag, seen } = dragging();
    const before = plot.mainPane.flex;
    const boom = new Error("pane subscriber failed");
    plot.mainPane.subscribe((change) => {
      if (change.settings) throw boom;
    });

    expect(caught(() => drag(0, 40))).toBe(boom);

    // The first pane already moved before the loop broke — a follower must hear of it.
    expect(plot.mainPane.flex).not.toBe(before);
    expect(seen).toHaveLength(2);
  });

  it("should keep the subscriber's error first when the announcement throws too", () => {
    const { plot, drag } = dragging();
    const boom = new Error("pane subscriber failed");
    const late = new Error("follower failed");
    plot.mainPane.subscribe((change) => {
      if (change.settings) throw boom;
    });
    plot.on("panesChange", () => {
      throw late;
    });

    const error = caught(() => drag(0, 40));

    expect(error).toBeInstanceOf(AggregateError);
    const errors = error instanceof AggregateError ? error.errors : [];
    expect(errors).toEqual([boom, late]);
  });
});

/** A two-pane chart whose divider drag is driven by hand — the fake divider just captures the callback. */
function dragging() {
  // The DOM divider moved to @finchart/dom — what's tested here is the core
  // wiring by which a drag callback reaches the panes event.
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
  const seen: PaneLayout[][] = [];
  plot.on("panesChange", () => seen.push(layoutOf(plot)));
  plot.addPane();
  plot.render();
  const drag = (index: number, dy: number): void => {
    if (!captured.drag) throw new Error("the divider wiring never received a drag callback");
    captured.drag(index, dy);
  };
  return { plot, drag, seen };
}

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

  it("should announce itself as a panes change", () => {
    const { plot, seen } = mounted();

    plot.mainPane.setValueDomain(0, 100);

    expect(seen.at(-1)?.[0]).toEqual({ flex: 1, autoScale: false });
  });

  it("should stay quiet when it restates the manual range already held", () => {
    const { plot, seen } = mounted();
    plot.mainPane.setValueDomain(0, 100);
    const before = seen.length;

    plot.mainPane.setValueDomain(0, 100);

    expect(seen).toHaveLength(before);
  });

  it("should announce a manual range that moves only its top", () => {
    const { plot, seen } = mounted();
    plot.mainPane.setValueDomain(0, 100);
    const before = seen.length;

    plot.mainPane.setValueDomain(0, 200);

    expect(seen).toHaveLength(before + 1);
    plot.destroy();
  });

  it("should announce a scale swap once — a log toggle is a mode, like invert", () => {
    const { plot, seen } = mounted();

    plot.mainPane.setYScale(new LogScale());
    plot.mainPane.setYScale(new LinearScale());

    expect(seen).toHaveLength(2);
  });

  it("should stay quiet when the scale handed in is the one installed", () => {
    const { plot, seen } = mounted();

    // A render that passes the same cached scale again is not a toggle.
    plot.mainPane.setYScale(plot.mainPane.yScale);

    expect(seen).toHaveLength(0);
  });

  it("should announce a swap that refits a manual range once, for the swap", () => {
    const { plot, seen } = mounted();
    // A floor below zero — a log axis cannot hold it, so the swap refits.
    plot.mainPane.setValueDomain(-10, 100);
    const before = seen.length;

    plot.mainPane.setYScale(new LogScale());

    expect(plot.mainPane.autoScale).toBe(false);
    expect(plot.mainPane.yScale.getDomain()[0]).toBeGreaterThan(0);
    expect(seen).toHaveLength(before + 1);
  });

  it("should stay quiet when new data refits a manual range — data is not a setting", () => {
    const { plot, handle, seen } = mounted();
    plot.mainPane.setValueDomain(0, 100);
    const before = seen.length;

    handle.setData([{ x: 0, y: 500 }, { x: 10, y: 700 }]);

    expect(plot.mainPane.yScale.getDomain()).not.toEqual([0, 100]);
    expect(seen).toHaveLength(before);
  });

  it("should announce a range set by hand on a pane that had only turned autoScale off", () => {
    const { plot, seen } = mounted();
    plot.mainPane.applyOptions({ autoScale: false });
    const [min, max] = plot.mainPane.yScale.getDomain();
    const before = seen.length;

    // The same numbers the axis already shows — but now they are the user's.
    plot.mainPane.setValueDomain(min, max);

    expect(seen).toHaveLength(before + 1);
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

  it("fitDomains with every pane already following stays quiet — an x-only fit is not a pane change", () => {
    const { plot, seen } = mounted();
    plot.setVisibleRange(50, 60);

    plot.fitDomains();

    expect(seen).toHaveLength(0);
  });

  it("fitDomains with one manual pane rings exactly once", () => {
    const { plot, seen } = mounted();
    plot.addPane();
    plot.mainPane.setValueDomain(0, 100);
    const before = seen.length;

    plot.fitDomains();

    expect(seen).toHaveLength(before + 1);
  });

  it("an explicit fitDomains still fits x — the window you scrolled to is gone", () => {
    const { plot } = mounted();
    const whole = plot.getVisibleRange();
    plot.setVisibleRange(50, 60);
    expect(plot.getVisibleRange()).not.toEqual(whole);
    plot.fitDomains();
    expect(plot.getVisibleRange()).toEqual(whole);
  });

  it("rings panesChange once for the whole fit, and a listener that removes a pane does not hide the next one", () => {
    const { plot, seen } = mounted();
    const a = plot.addPane();
    const b = plot.addPane();
    for (const pane of [plot.mainPane, a, b]) pane.setValueDomain(0, 100);
    plot.setVisibleRange(50, 60);
    const before = seen.length;
    // A follower that, on seeing `a` follow the data again, drops the pane — the stack is `[main, a, b]`.
    plot.on("panesChange", () => {
      if (a.autoScale && plot.panes.includes(a)) plot.removePane(a);
    });

    plot.fitDomains();

    expect(plot.panes).toEqual([plot.mainPane, b]);
    expect(plot.mainPane.autoScale).toBe(true);
    expect(b.autoScale).toBe(true);
    // One for the fit (three panes together); the removal rings its own afterwards.
    expect(seen.length - before).toBe(2);
    expect(seen[before]?.map((pane) => pane.autoScale)).toEqual([true, true, true]);
  });

  it("a listener that throws on the fit's notification does not undo the fit — every pane is reset and the error is the listener's own", () => {
    const { plot } = mounted();
    const a = plot.addPane();
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(0, 100);
    plot.setVisibleRange(50, 60);
    const boom = new Error("follower failed");
    plot.on("panesChange", () => {
      throw boom;
    });

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(plot.mainPane.autoScale).toBe(true);
    expect(a.autoScale).toBe(true);
    expect(plot.getVisibleRange()).not.toEqual({ min: 50, max: 60 });
  });

  it("a listener that throws mid-fit (xDomainChange) does not stop it — y is fitted and the panes reset, the error is still its own", () => {
    // A manual scheduler: nothing renders on its own, so what the fit did is all there is.
    const { deps, yScale } = testBrowserDepsWithScales({ createScheduler: manualScheduler() });
    const { plot } = mountPlot({ deps, series: lineSeries(), data });
    const whole = plot.getVisibleRange();
    const a = plot.addPane();
    // A manual range nowhere near the data: only the fit itself can move it before the next frame.
    for (const pane of [plot.mainPane, a]) pane.setValueDomain(1000, 2000);
    plot.setVisibleRange(50, 60);
    const boom = new Error("x mirror failed");
    plot.on("xDomainChange", () => {
      throw boom;
    });

    expect(caught(() => plot.fitDomains())).toBe(boom);

    expect(plot.getVisibleRange()).toEqual(whole);
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
    const panesBoom = new Error("panes");
    let notified = 0;
    plot.on("xDomainChange", () => {
      throw xBoom;
    });
    a.subscribe((change) => {
      if (change.settings) throw paneBoom;
    });
    plot.on("panesChange", () => {
      notified += 1;
      throw panesBoom;
    });

    const error = caught(() => plot.fitDomains());

    expect(error).toBeInstanceOf(AggregateError);
    const errors = error instanceof AggregateError ? error.errors : [];
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe(xBoom);
    expect(errors[1]).toBe(paneBoom);
    expect(errors[2]).toBe(panesBoom);
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
      if (change.settings) throw boom;
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
      if (change.settings && a.autoScale) {
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
