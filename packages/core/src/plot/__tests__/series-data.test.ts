/**
 * The registration owns the data. The stage used to hold a single
 * dataset shared by every series, so BTC and ETH could never be drawn on
 * one stage together.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { candleSeries, lineSeries } from "../../series";
import { seriesSpec } from "../pane";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const ramp = (from: number, to: number, y: (x: number) => number): LineDataPoint[] =>
  Array.from({ length: to - from }, (_, i) => ({ x: from + i, y: y(from + i) }));

/** A stage mounted with no series. Used by tests that attach registrations by hand. */
function bare() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot } = mountPlot<LineDataPoint>({
    deps,
    config: { ...defaultConfig, showGrid: false },
  });

  return { plot, xScale, yScale };
}

describe("different data per series", () => {
  it("should let two series hold different datasets", () => {
    const { plot } = bare();

    const btc = plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(0, 10, (x) => 40_000 + x),
    });
    const eth = plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(100, 110, (x) => 2_000 + x),
    });

    expect(btc.xRange).toEqual({ min: 0, max: 9 });
    expect(eth.xRange).toEqual({ min: 100, max: 109 });
  });

  it("should span the union of every series on the x axis", () => {
    const { plot, xScale } = bare();

    plot.mainPane.addSeries({ series: lineSeries(), data: ramp(0, 10, () => 1) });
    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(100, 110, () => 1),
    });
    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([0, 109]);
  });

  it("should keep the other series when one is disposed", () => {
    const { plot, xScale } = bare();

    plot.mainPane.addSeries({ series: lineSeries(), data: ramp(0, 10, () => 1) });
    const late = plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(100, 110, () => 1),
    });

    late.dispose();
    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([0, 9]);
  });

  /** The reason valueExtent's type opened up to Range | null — if a series with no data yet returned {0,0}, the union would get dragged down to 0, squashing candles against the bottom of the screen. */
  it("should not drag the value axis to zero for a series with no data yet", () => {
    const { plot } = bare();

    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(0, 10, () => 40_000),
    });
    plot.mainPane.addSeries({ series: lineSeries() }); // the one that hasn't arrived yet

    const extent = plot.mainPane.valueExtent();

    expect(extent).toEqual({ min: 40_000, max: 40_000 });
  });
});

describe("refit rules", () => {
  /** Registers with data, then moves the window. */
  function panned() {
    const { plot, xScale } = bare();
    const handle = plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(0, 100, (x) => x),
    });

    plot.pan(-20);
    return { plot, xScale, handle, viewing: xScale.getDomain() };
  }

  it("should fit the first data that arrives", () => {
    const { plot, xScale } = bare();

    // Up to that point the x domain is the scale's default — nothing is in place yet.
    expect(xScale.getDomain()).toEqual([0, 1]);

    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(10, 20, () => 1),
    });

    expect(xScale.getDomain()).toEqual([10, 19]);
  });

  it("should refit on the imperative setData", () => {
    const { xScale, handle } = panned();

    handle.setData(ramp(-50, 100, (x) => x));

    // A new dataset, so it snaps back to showing everything
    expect(xScale.getDomain()).toEqual([-50, 99]);
  });

  /** The declarative path never refits — if the window jumped to the union, the user would lose their place. */
  it("should not refit when a spec brings new data", () => {
    const { plot, xScale } = bare();
    const series = lineSeries();
    const spec = (data: LineDataPoint[]) =>
      seriesSpec<LineDataPoint>({ id: "a", series, data });

    plot.mainPane.syncSeries([spec(ramp(0, 100, (x) => x))]);
    plot.pan(-20);
    const viewing = xScale.getDomain();

    // A new array with history prepended. This is exactly what infinite scroll does.
    plot.mainPane.syncSeries([spec(ramp(-50, 100, (x) => x))]);

    expect(xScale.getDomain()).toEqual(viewing);
  });

  it("should not refit when a later series joins", () => {
    const { plot, xScale, viewing } = panned();

    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(500, 600, () => 1),
    });

    expect(xScale.getDomain()).toEqual(viewing);
  });

  it("should refit on an explicit fitDomains", () => {
    const { plot, xScale, handle } = panned();
    handle.prepend(ramp(-50, 0, (x) => x));

    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([-50, 99]);
  });
});

/**
 * What generic erasure makes possible — since a pane has no point-type
 * parameter, series with different source types can live in the same pane.
 */
describe("series with different point types in one pane", () => {
  it("should hold candles and lines side by side", () => {
    const { plot, xScale } = bare();

    const btc = plot.mainPane.addSeries({
      series: candleSeries(),
      data: [
        { x: 0, open: 40_000, high: 41_000, low: 39_000, close: 40_500 },
        { x: 1, open: 40_500, high: 42_000, low: 40_000, close: 41_800 },
      ] satisfies OHLC[],
    });

    const eth = plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp(2, 5, () => 2_000),
    });

    // Each handle still knows its own point type.
    expect(btc.read()[0].close).toBe(40_500);
    expect(eth.read()[0].y).toBe(2_000);

    // The value axis spans both.
    expect(plot.mainPane.valueExtent()).toEqual({ min: 2_000, max: 42_000 });

    // ETH being attached later doesn't jump the window — the refit rules still apply.
    expect(xScale.getDomain()).toEqual([0, 1]);
    plot.fitDomains();
    expect(xScale.getDomain()).toEqual([0, 4]);
  });
});
