import { describe, expect, it } from "vitest";
import { strokedPaths } from "../../__tests__/dom-fakes";
import { Axis } from "../../axis";
import type { OHLC } from "../../data";
import { OHLCAccessor } from "../../data";
import { AreaSeries, CandleSeries, LineSeries } from "../../series";
import { DEFAULT_PLOT_STYLE } from "../style";
import { defaultConfig, mountPlot } from "./helpers";
import { testBrowserDeps } from "../../__tests__/dom-fakes";

/** The same OHLC data can be drawn as either a line or candles. */
const candles: OHLC[] = [
  { x: 0, open: 10, high: 30, low: 5, close: 20 },
  { x: 1, open: 20, high: 40, low: 15, close: 18 },
  { x: 2, open: 18, high: 25, low: 2, close: 24 },
];

const lineOverOHLC = () => new LineSeries({ coordinates: new OHLCAccessor() });

describe("series swap", () => {
  it("should keep the pan position when the series changes", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineOverOHLC(), data: candles });

    plot.pan(0.5);
    const pannedX = deps.xScale.getDomain();

    plot.setSeries({ series: new CandleSeries(), data: candles });

    expect(deps.xScale.getDomain()).toEqual(pannedX);
  });

  it("should keep the same overlay element across a swap", () => {
    const deps = testBrowserDeps();
    const { plot, layers } = mountPlot({ deps, series: lineOverOHLC(), data: candles });

    const overlay = plot.overlay;
    plot.setSeries({ series: new CandleSeries(), data: candles });

    expect(plot.overlay).toBe(overlay);
    expect(layers.destroyed).toBe(false);
  });

  it("should refit the value domain to the new series", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineOverOHLC(), data: candles });

    // The line only looks at close (18~24).
    const [lineMin, lineMax] = deps.mainPaneYScale.getDomain();
    expect(lineMin).toBeLessThan(18);
    expect(lineMax).toBeGreaterThan(24);
    expect(lineMin).toBeGreaterThan(5);

    plot.setSeries({ series: new CandleSeries(), data: candles });

    // Candles take up the whole range from low (2) to high (40).
    const [candleMin, candleMax] = deps.mainPaneYScale.getDomain();
    expect(candleMin).toBeLessThan(2);
    expect(candleMax).toBeGreaterThan(40);
  });

  it("should swap only this registration through the handle — others survive", () => {
    // plot.setSeries empties the whole pane — switching chart type
    // (candle<->area) has to keep a neighboring series like a moving
    // average alive, so it's the handle's door.
    const deps = testBrowserDeps();
    const { plot, handle } = mountPlot({
      deps,
      series: new CandleSeries(),
      data: candles,
    });
    plot.mainPane.addSeries({ series: lineOverOHLC(), data: candles });
    expect(plot.mainPane.getSeries()).toHaveLength(2);

    handle.swapSeries(new AreaSeries({ coordinates: new OHLCAccessor() }));

    expect(plot.mainPane.getSeries()).toHaveLength(2);
    // The value axis refits to the new series' extent — from candles (low
    // 2~high 40) to a close-price area (18~24).
    const [min, max] = deps.mainPaneYScale.getDomain();
    expect(min).toBeGreaterThan(5);
    expect(max).toBeLessThan(40);
    // The handle stays alive — a live tick still flows through unchanged.
    handle.updateLast({ x: 2, open: 18, high: 25, low: 2, close: 26 });
    expect(handle.read().at(-1)?.close).toBe(26);
  });

  it("should keep candle wicks inside the plot area", () => {
    const deps = testBrowserDeps();
    const { layers } = mountPlot({ deps, series: new CandleSeries(), data: candles });

    const wicks = strokedPaths(layers.context).filter(
      (p) => p.width !== DEFAULT_PLOT_STYLE.grid.width,
    );

    expect(wicks).toHaveLength(candles.length);
    for (const { points } of wicks) {
      for (const point of points) {
        expect(point.y).toBeGreaterThanOrEqual(defaultConfig.padding.top);
        expect(point.y).toBeLessThanOrEqual(600 - defaultConfig.padding.bottom);
      }
    }
  });

  it("should still draw the grid on the axis ticks after a swap", () => {
    const deps = testBrowserDeps();
    const { plot, layers } = mountPlot({ deps, series: lineOverOHLC(), data: candles });

    plot.setSeries({ series: new CandleSeries(), data: candles });

    const axisConfig = {};
    const verticals = strokedPaths(layers.context)
      .filter((p) => p.width === DEFAULT_PLOT_STYLE.grid.width)
      .filter(({ points }) => points[0].x === points[1].x)
      .map(({ points }) => points[0].x);

    const xTicks = new Axis(deps.xScale, "horizontal", axisConfig).getTicks();
    expect(verticals).toEqual(xTicks.map((t) => t.position));
  });

  it("should report the active series", () => {
    const deps = testBrowserDeps();
    const { plot } = mountPlot({ deps, series: lineOverOHLC() });
    const candle = new CandleSeries();

    plot.setSeries(candle);

    expect(plot.getSeries()).toBe(candle);
  });

  /** Data belongs to the registration, so it doesn't carry over on a swap — it must be given alongside the new registration. */
  it("should leave the pane empty when the new series brings no data", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineOverOHLC(), data: candles });

    plot.setSeries(new CandleSeries());

    expect(plot.mainPane.xRange()).toBeNull();
  });
});
