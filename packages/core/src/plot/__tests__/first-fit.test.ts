/**
 * The fit x takes when data arrives. A chart mounted empty and fed bar by
 * bar must not stay fitted to the first bar alone; a chart whose data goes
 * empty and comes back (a loading state between two symbols) fits the new
 * data.
 */
import { describe, expect, it } from "vitest";
import type { OHLC } from "../../data";
import { seriesSpec } from "../../registration";
import { barIndexX } from "../../scale";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { mountPlot } from "./helpers";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function bar(x: number): OHLC {
  return { x, open: 1, high: 2, low: 0.5, close: 1.5 };
}

function bars(count: number, start = T0, step = MINUTE): OHLC[] {
  return Array.from({ length: count }, (_, i) => bar(start + i * step));
}

describe("a chart fed bar by bar from empty", () => {
  it("keeps every streamed bar in view under continuous x", () => {
    const { deps, xScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: candleSeries(), data: [] });

    for (const point of bars(50)) handle.append([point]);

    const [min, max] = xScale.getDomain();
    expect(min).toBeLessThanOrEqual(T0);
    expect(max).toBeGreaterThanOrEqual(T0 + 49 * MINUTE);
    plot.destroy();
  });

  it("keeps every streamed bar in view under bar-index x", () => {
    const { deps, xScale } = testBrowserDepsWithScales({ createXMapping: barIndexX });
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: candleSeries(), data: [] });

    for (const point of bars(50)) handle.append([point]);

    const [min, max] = xScale.getDomain();
    expect(min).toBeLessThanOrEqual(0);
    expect(max).toBeGreaterThanOrEqual(49);
    plot.destroy();
  });

  it("stops following the data once the window is moved", () => {
    const { deps, xScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: candleSeries(), data: [] });
    for (const point of bars(10)) handle.append([point]);

    plot.setVisibleRange(T0 + 2 * MINUTE, T0 + 5 * MINUTE);
    handle.append([bar(T0 + 10 * MINUTE)]);

    expect(xScale.getDomain()).toEqual([T0 + 2 * MINUTE, T0 + 5 * MINUTE]);
    plot.destroy();
  });

  it("leaves a window fitted to more than one bar where it is", () => {
    const { deps, xScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: candleSeries(), data: bars(10) });
    const fitted = xScale.getDomain();

    handle.append([bar(T0 + 10 * MINUTE)]);

    expect(xScale.getDomain()).toEqual(fitted);
    plot.destroy();
  });
});

describe("declarative data that goes empty and comes back", () => {
  it("fits the data that arrives after the empty state", () => {
    const { deps, xScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const sync = (data: OHLC[]) =>
      plot.mainPane.syncSeries([seriesSpec<OHLC>({ id: "price", series: candleSeries(), data })]);

    sync(bars(300, T0, 86_400_000));
    sync([]);
    const later = T0 + 400 * 86_400_000;
    sync(bars(300, later));

    const [min, max] = xScale.getDomain();
    expect(min).toBeLessThanOrEqual(later);
    expect(min).toBeGreaterThan(later - 10 * MINUTE);
    expect(max).toBeGreaterThanOrEqual(later + 299 * MINUTE);
    plot.destroy();
  });
});

describe("a value range set by hand, then the data goes empty", () => {
  const around = (level: number) =>
    Array.from({ length: 20 }, (_, i) => ({ x: T0 + i * MINUTE, y: level + (i % 3) }));

  it("does not survive into the next data — the new data is fitted", () => {
    const { deps, yScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: lineSeries(), data: around(100) });
    plot.mainPane.setValueDomain(90, 110);

    handle.setData([]);
    handle.setData(around(5000));

    const [min, max] = yScale.getDomain();
    expect(min).toBeGreaterThan(4000);
    expect(max).toBeGreaterThan(5000);
    plot.destroy();
  });

  it("a range set while the chart is empty is still kept by the next data", () => {
    const { deps, yScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps });
    const handle = plot.mainPane.addSeries({ series: lineSeries(), data: around(100) });
    plot.mainPane.setValueDomain(90, 110);
    handle.setData([]);

    plot.mainPane.setValueDomain(4000, 6000);
    handle.setData([]);
    handle.setData(around(5000));

    expect(yScale.getDomain()).toEqual([4000, 6000]);
    plot.destroy();
  });
});
