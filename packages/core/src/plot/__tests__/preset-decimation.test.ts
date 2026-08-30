/**
 * The manager defaults a registration actually receives. The wiring used
 * to hold the manager instance so it could be asked about directly, but
 * since data moved down into the registration, it has to be asked at the
 * end of the chain that builds a registration's manager.
 */
import { describe, expect, it } from "vitest";
import {
  defaultCoordinates,
  type BaseDataPoint,
  type DataManager,
  type LineDataPoint,
  type OHLC,
} from "../../data";
import { candleSeries, lineSeries, type Series } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { PlotDeps } from "../types";

const viewport = (width: number) => ({
  startX: -1,
  endX: 1_000_000,
  width,
  height: 600,
});

/** The exact path a registration builds its manager through — this is what `plainEntry` does. */
function managerFor<T extends BaseDataPoint>(
  deps: PlotDeps,
  series: Series<T>,
): DataManager<T> {
  return deps.createDataManager<T>(
    series.coordinates ?? defaultCoordinates<T>(),
    series.decimation,
  );
}

function line(count: number): LineDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: 0 }));
}

function candles(count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
}

describe("wiring default — a series that declares no policy", () => {
  it("should keep both spikes that share a pixel column", () => {
    const data = line(100_000);
    data[50_000].y = 999;
    data[50_001].y = -999;

    const manager = managerFor(testBrowserDeps(), lineSeries());
    manager.setData(data);

    const ys = manager.getVisibleData(viewport(800)).map((p) => p.y);

    // Back when the grid was the default, only a bucket's first point survived and both would have disappeared.
    expect(ys).toContain(999);
    expect(ys).toContain(-999);
  });

  it("should draw at least one point per pixel", () => {
    const manager = managerFor(testBrowserDeps(), lineSeries());
    manager.setData(line(100_000));

    // Back when the default cap was 1000, it got truncated at 1000 points regardless of width.
    expect(
      manager.getVisibleData(viewport(2000)).length,
    ).toBeGreaterThanOrEqual(2000);
  });

  it("should still honour an explicit maxPoints", () => {
    const manager = managerFor(testBrowserDeps({ maxPoints: 500 }), lineSeries());
    manager.setData(line(100_000));

    expect(manager.getVisibleData(viewport(2000)).length).toBeLessThanOrEqual(
      500,
    );
  });
});

describe("the policy a candle series brings with it", () => {
  it("should merge candles instead of dropping them", () => {
    const data = candles(100_000);
    data[50_000].high = 9999;
    data[50_001].low = -9999;

    const manager = managerFor(testBrowserDeps(), candleSeries());
    manager.setData(data);

    const visible = manager.getVisibleData(viewport(800));

    // Even with the high and the low on different candles, both survive.
    expect(visible.map((candle) => candle.high)).toContain(9999);
    expect(visible.map((candle) => candle.low)).toContain(-9999);
  });

  it("should not draw more than one candle per pixel", () => {
    const manager = managerFor(testBrowserDeps(), candleSeries());
    manager.setData(candles(100_000));

    expect(manager.getVisibleData(viewport(800)).length).toBeLessThanOrEqual(
      800,
    );
  });

  /**
   * One pixel per bar is a cap on candles, not on an indicator line —
   * applying the same value to a derived series too would prevent it from
   * drawing even one point per pixel. Only candles bring their own
   * policy, so there's no need to separately gate raw vs. derived.
   */
  it("should not starve derived series of the candle density", () => {
    // A smooth line like a moving average. This is the shape M4 produces, emitting only the two endpoints per column.
    const data: LineDataPoint[] = Array.from({ length: 100_000 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 5000) * 100,
    }));

    const manager = managerFor(testBrowserDeps(), lineSeries());
    manager.setData(data);

    for (const width of [800, 1600, 3840]) {
      const drawn = manager.getVisibleData(viewport(width)).length;
      expect(drawn / width).toBeGreaterThanOrEqual(1);
    }
  });

  /** A derived series like a moving average is not a candle — inheriting the source's strategy as-is would read undefined. */
  it("should give derived series a strategy that fits their points", () => {
    const data = line(100_000);
    data[50_000].y = 999;

    const manager = testBrowserDeps().createDataManager(
      defaultCoordinates<LineDataPoint>(),
    );
    manager.setData(data);

    const visible = manager.getVisibleData(viewport(800));

    expect(visible.every((point) => typeof point.y === "number")).toBe(true);
    expect(visible.map((point) => point.y)).toContain(999);
  });

  /** The wiring's density setting can't change a candle — the series brings its own policy, and that wins. To change it, override at the registration. */
  it("should let the registration, not the wiring, raise candle density", () => {
    const deps = testBrowserDeps({ pointsPerPixel: 2 });

    const byWiring = managerFor(deps, candleSeries());
    byWiring.setData(candles(100_000));
    expect(byWiring.getVisibleData(viewport(800)).length).toBeLessThanOrEqual(
      800,
    );

    const byRegistration = deps.createDataManager<OHLC>(
      candleSeries().coordinates,
      { ...candleSeries().decimation, pointsPerPixel: 2 },
    );
    byRegistration.setData(candles(100_000));
    expect(byRegistration.getVisibleData(viewport(800)).length).toBe(1600);
  });
});
