/**
 * The window a fit leaves around the data, and the window a chart fed bar
 * by bar from empty keeps.
 *
 * A fit pads each end by half a bar when a series draws a bar body (a
 * line alone fits edge to edge), so the first and last candles are
 * drawn whole instead of cut down the middle by the plot edge. Everything
 * that measures "the live edge" — the new-bar shift, `scrollToRealTime` —
 * counts that padded end as live.
 *
 * A chart streamed from empty fills the screen until its bars would be
 * squeezed below the default bar spacing, then keeps that width and
 * follows the newest bar.
 */
import { describe, expect, it } from "vitest";
import type { OHLC } from "../../data";
import { barIndexX } from "../../scale";
import { FALLBACK_SLOT, candleSeries, lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import type { PlotConfig } from "../types";
import { syncX } from "../../extensions/sync";
import { defaultConfig, mountPlot } from "./helpers";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function bar(x: number): OHLC {
  return { x, open: 1, high: 2, low: 0.5, close: 1.5 };
}

function bars(count: number, start = T0, step = MINUTE): OHLC[] {
  return Array.from({ length: count }, (_, i) => bar(start + i * step));
}

function mount(barIndex: boolean, config: PlotConfig = defaultConfig) {
  const { deps, xScale } = testBrowserDepsWithScales(barIndex ? { createXMapping: barIndexX } : {});
  const { plot } = mountPlot({ deps, config });
  // Lay the frame out once, so the x scale knows its pixel width.
  plot.render();
  const handle = plot.mainPane.addSeries({ series: candleSeries(), data: [] });
  return { plot, handle, xScale };
}

describe("a fit pads each end by half a bar", () => {
  it("continuous x: the first and last candles sit whole inside the plot", () => {
    const { plot, handle, xScale } = mount(false);
    handle.setData(bars(3));

    expect(xScale.getDomain()).toEqual([T0 - MINUTE / 2, T0 + 2 * MINUTE + MINUTE / 2]);
    plot.destroy();
  });

  it("bar-index x: half an index at each end", () => {
    const { plot, handle, xScale } = mount(true);
    handle.setData(bars(3));

    expect(xScale.getDomain()).toEqual([-0.5, 2.5]);
    plot.destroy();
  });

  it("rightOffset adds on top of the half bar", () => {
    const { plot, handle, xScale } = mount(true, { ...defaultConfig, rightOffset: 3 });
    handle.setData(bars(3));

    expect(xScale.getDomain()).toEqual([-0.5, 5.5]);
    plot.destroy();
  });
});

describe("the live edge is the padded end", () => {
  it("the new-bar shift keeps the new bar whole after a padded fit", () => {
    for (const barIndex of [false, true]) {
      const { plot, handle, xScale } = mount(barIndex, { ...defaultConfig, shiftVisibleRangeOnNewBar: true });
      handle.setData(bars(10));
      const [min, max] = xScale.getDomain();

      handle.append([bar(T0 + 10 * MINUTE)]);

      const step = barIndex ? 1 : MINUTE;
      expect(xScale.getDomain()).toEqual([min + step, max + step]);
      plot.destroy();
    }
  });

  it("scrollToRealTime lands on the padded end", () => {
    const { plot, handle, xScale } = mount(true);
    handle.setData(bars(10));
    plot.setVisibleRange(T0, T0 + 4 * MINUTE);

    plot.scrollToRealTime();

    expect(xScale.getDomain()).toEqual([5.5, 9.5]);
    plot.destroy();
  });
});

describe("a chart streamed from empty fills, then follows", () => {
  for (const barIndex of [false, true]) {
    it(`${barIndex ? "bar-index" : "continuous"} x: 500 bars keep the default spacing and the newest bar at the right edge`, () => {
      const { plot, handle, xScale } = mount(barIndex);
      const all = bars(500);
      for (const point of all) handle.append([point]);

      const last = all[499].x;
      const spacing = plot.pixelAtX(last) - plot.pixelAtX(all[498].x);
      expect(spacing).toBeGreaterThanOrEqual(FALLBACK_SLOT - 1e-9);
      // The newest bar sits half a bar inside the right edge.
      const [, right] = xScale.getRange();
      expect(right - plot.pixelAtX(last)).toBeCloseTo(spacing / 2, 6);
      plot.destroy();
    });
  }

  it("keeps following at the default spacing without shiftVisibleRangeOnNewBar", () => {
    const { plot, handle, xScale } = mount(true);
    for (const point of bars(500)) handle.append([point]);
    const width = xScale.getDomain()[1] - xScale.getDomain()[0];

    handle.append([bar(T0 + 500 * MINUTE)]);

    const [min, max] = xScale.getDomain();
    expect(max - min).toBeCloseTo(width, 9);
    expect(max).toBe(500.5);
    plot.destroy();
  });

  it("fills the screen while the bars are wider than the default spacing", () => {
    const { plot, handle, xScale } = mount(true);
    for (const point of bars(40)) handle.append([point]);

    expect(xScale.getDomain()).toEqual([-0.5, 39.5]);
    plot.destroy();
  });

  it("a single bar gets a window a few bars wide, not a slice of the epoch", () => {
    for (const barIndex of [false, true]) {
      const { plot, handle, xScale } = mount(barIndex);
      handle.append([bar(T0)]);

      const [min, max] = xScale.getDomain();
      const at = barIndex ? 0 : T0;
      expect(min).toBeLessThan(at);
      expect(max).toBeGreaterThan(at);
      // A few bars — one unit is one bar while the data has no spacing to measure.
      expect(max - min).toBeGreaterThanOrEqual(2);
      expect(max - min).toBeLessThanOrEqual(20);
      plot.destroy();
    }
  });

  it("a single bar after an emptied chart takes the spacing the chart last knew", () => {
    const { plot, handle, xScale } = mount(false);
    handle.setData(bars(10));
    handle.setData([]);
    handle.append([bar(T0 + 100 * MINUTE)]);

    const [min, max] = xScale.getDomain();
    expect(max - min).toBeGreaterThanOrEqual(2 * MINUTE);
    expect(max - min).toBeLessThanOrEqual(20 * MINUTE);
    plot.destroy();
  });

  it("a repeated x is no spacing — the window does not collapse onto it", () => {
    const { plot, xScale } = mount(false);
    const line = plot.mainPane.addSeries({ series: lineSeries(), data: [] });
    line.append([{ x: T0, y: 1 }]);
    line.append([{ x: T0, y: 2 }]);

    const [min, max] = xScale.getDomain();
    expect(min).toBeLessThan(T0);
    expect(max).toBeGreaterThan(T0);
    plot.destroy();
  });
});

describe("follow mode survives a window that does not change", () => {
  it("two syncX charts streamed from empty both fill and follow", () => {
    for (const barIndex of [false, true]) {
      const a = mount(barIndex);
      const b = mount(barIndex);
      const release = syncX(a.plot, b.plot);
      for (const point of bars(60)) {
        a.handle.append([point]);
        b.handle.append([point]);
      }

      for (const { xScale } of [a, b]) {
        const [min, max] = xScale.getDomain();
        const first = barIndex ? 0 : T0;
        const last = barIndex ? 59 : T0 + 59 * MINUTE;
        expect(min).toBeLessThanOrEqual(first);
        expect(max).toBeGreaterThanOrEqual(last);
      }
      release();
      a.plot.destroy();
      b.plot.destroy();
    }
  });

  it("a listener that throws while the fit is announced does not end follow mode", () => {
    const { plot, handle, xScale } = mount(true);
    let fail = true;
    plot.on("xDomainChange", () => {
      if (fail) throw new Error("listener");
    });
    expect(() => handle.append([bar(T0)])).toThrow();
    fail = false;

    for (let i = 1; i < 40; i++) handle.append([bar(T0 + i * MINUTE)]);

    expect(xScale.getDomain()).toEqual([-0.5, 39.5]);
    plot.destroy();
  });
});

describe("a short first history fills, then follows", () => {
  it("a first message of a few bars keeps following as more arrive", () => {
    for (const barIndex of [false, true]) {
      const { plot, handle, xScale } = mount(barIndex);
      handle.setData(bars(3));
      for (let i = 3; i < 40; i++) handle.append([bar(T0 + i * MINUTE)]);

      const [min, max] = xScale.getDomain();
      expect(min).toBeLessThanOrEqual(barIndex ? 0 : T0);
      expect(max).toBeGreaterThanOrEqual(barIndex ? 39 : T0 + 39 * MINUTE);
      plot.destroy();
    }
  });

  it("a first history wider than the screen holds at the default spacing does not follow", () => {
    const { plot, handle, xScale } = mount(true);
    handle.setData(bars(500));
    const fitted = xScale.getDomain();

    handle.append([bar(T0 + 500 * MINUTE)]);

    expect(xScale.getDomain()).toEqual(fitted);
    plot.destroy();
  });
});

describe("the half-bar margin belongs to series that draw a bar body", () => {
  it("a line fits edge to edge", () => {
    for (const barIndex of [false, true]) {
      const { deps, xScale } = testBrowserDepsWithScales(barIndex ? { createXMapping: barIndexX } : {});
      const { plot } = mountPlot({ deps });
      plot.render();
      plot.mainPane.addSeries({ series: lineSeries(), data: [{ x: 0, y: 1 }, { x: 100, y: 2 }] });

      expect(xScale.getDomain()).toEqual(barIndex ? [0, 1] : [0, 100]);
      expect(plot.leadingMargin()).toBe(0);
      plot.destroy();
    }
  });

  it("a line next to candles takes the candles' margin", () => {
    const { plot, handle, xScale } = mount(false);
    plot.mainPane.addSeries({ series: lineSeries(), data: [{ x: T0, y: 1 }, { x: T0 + 2 * MINUTE, y: 2 }] });
    handle.setData(bars(3));

    expect(xScale.getDomain()).toEqual([T0 - MINUTE / 2, T0 + 2 * MINUTE + MINUTE / 2]);
    expect(plot.leadingMargin()).toBe(MINUTE / 2);
    plot.destroy();
  });
});
