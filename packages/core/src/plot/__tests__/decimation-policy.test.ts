/**
 * The decimation policy comes from the place that knows the point type. If
 * the branch separating raw from derived series disappears, a candle's
 * decimation strategy could silently change — the screen and the bench
 * both change, but no test breaks. So we verify the chain itself.
 */
import { describe, expect, it } from "vitest";
import {
  LineDataAccessor,
  M4Decimation,
  mergePolicy,
  OHLCAccessor,
  OhlcAggregation,
  type CoordinateAccessor,
  type DataView,
  type DataManager,
  type DecimationPolicy,
  type LineDataPoint,
  type OHLC,
} from "../../data";
import { LinearScale } from "../../scale";
import { candleSeries, CandleSeries, lineSeries, LineSeries, type Series } from "../../series";
import { Pane } from "../pane";
import { testBrowserDeps } from "../../__tests__/dom-fakes";

const m4 = new M4Decimation(new LineDataAccessor());

describe("mergePolicy", () => {
  const strong: DecimationPolicy<LineDataPoint> = { pointsPerPixel: 1 };
  const weak: DecimationPolicy<LineDataPoint> = {
    strategy: m4,
    pointsPerPixel: 4,
  };

  it("should let the stronger side win field by field", () => {
    const merged = mergePolicy(strong, weak)!;

    expect(merged.pointsPerPixel).toBe(1);
    // It's fine to give only one side — a field it doesn't set comes from the weaker one.
    expect(merged.strategy).toBe(m4);
  });

  it("should pass the other side through when one is missing", () => {
    expect(mergePolicy(undefined, weak)).toBe(weak);
    expect(mergePolicy(strong, undefined)).toBe(strong);
    expect(mergePolicy(undefined, undefined)).toBeUndefined();
  });
});

describe("a series knows its own policy", () => {
  it("should give candles the policy that used to live in the wiring", () => {
    // The judgment call that presets.ts's ohlcDeps used to carry in prose.
    const { decimation } = candleSeries();

    expect(decimation.strategy).toBeInstanceOf(OhlcAggregation);
    expect(decimation.pointsPerPixel).toBe(1);
  });

  it("should let lines say nothing, so the wiring decides", () => {
    // Nothing special about lines. The wiring default (M4 + 4) is correct.
    // Received via the contract — a concrete class doesn't declare an optional member.
    const line: Series<LineDataPoint> = lineSeries();

    expect(line.decimation).toBeUndefined();
  });
});

describe("policy precedence — registration > series > wiring", () => {
  /** Peek at what the factory actually received. */
  function paneWithSpy() {
    const deps = testBrowserDeps();
    const seen: Array<DecimationPolicy<OHLC> | undefined> = [];

    const createDataManager = <T extends { x: number }>(
      coords: CoordinateAccessor<T>,
      policy?: DecimationPolicy<T>,
    ): DataManager<T> => {
      seen.push(policy as DecimationPolicy<OHLC> | undefined);
      return deps.createDataManager(coords, policy);
    };

    return {
      seen,
      pane: new Pane(new LinearScale(), createDataManager),
    };
  }

  /** A derivation is needed for the registration to build its own manager. The value doesn't matter. */
  const toCandles = (source: DataView<LineDataPoint>): OHLC[] =>
    source.map((p) => {
      // Candles have no "no value" — a gap belongs to lines.
      const y = p.y ?? 0;
      return { x: p.x, open: y, high: y, low: y, close: y };
    });

  it("should pass nothing when neither declares a policy", () => {
    const { pane, seen } = paneWithSpy();

    pane.addSeries({ series: lineSeries(), derive: (s) => [...s] });

    expect(seen).toEqual([undefined]);
  });

  it("should pass the series' own policy when the registration is silent", () => {
    const { pane, seen } = paneWithSpy();

    pane.addSeries({ series: candleSeries(), derive: toCandles });

    expect(seen[0]?.pointsPerPixel).toBe(1);
    expect(seen[0]?.strategy).toBeInstanceOf(OhlcAggregation);
  });

  it("should let the registration override the series", () => {
    const { pane, seen } = paneWithSpy();

    pane.addSeries({
      series: candleSeries(),
      derive: toCandles,
      decimation: { pointsPerPixel: 8 },
    });

    // What the registration supplies wins; what it doesn't comes from the series.
    expect(seen[0]?.pointsPerPixel).toBe(8);
    expect(seen[0]?.strategy).toBeInstanceOf(OhlcAggregation);
  });

  it("should rebuild the chain with the new series' policy on swap", () => {
    // Start as a line (no declaration -> wiring default), then swap to a
    // candle — if the policy froze at construction time, close-based
    // decimation would erase the candle's high and low.
    const { pane, seen } = paneWithSpy();
    const candles: OHLC[] = [
      { x: 0, open: 10, high: 30, low: 5, close: 20 },
      { x: 1, open: 20, high: 40, low: 15, close: 18 },
    ];
    const handle = pane.addSeries({
      series: new LineSeries<OHLC>({ coordinates: new OHLCAccessor() }),
      data: candles,
    });
    expect(seen).toEqual([undefined]);

    handle.swapSeries(new CandleSeries());

    expect(seen).toHaveLength(2);
    expect(seen[1]?.strategy).toBeInstanceOf(OhlcAggregation);
    expect(seen[1]?.pointsPerPixel).toBe(1);
    // The data was reloaded into the new manager, and increments target the new manager too.
    expect(handle.read()).toHaveLength(2);
    handle.updateLast({ x: 2, open: 18, high: 25, low: 2, close: 24 });
    expect(handle.read()).toHaveLength(3);
  });

  it("should keep the registration override winning across a swap", () => {
    const { pane, seen } = paneWithSpy();

    const handle = pane.addSeries({
      series: new LineSeries<OHLC>({ coordinates: new OHLCAccessor() }),
      data: [] as OHLC[],
      decimation: { pointsPerPixel: 8 },
    });
    handle.swapSeries(new CandleSeries());

    // Registration > series — a rebuild goes through the same precedence.
    expect(seen[1]?.pointsPerPixel).toBe(8);
    expect(seen[1]?.strategy).toBeInstanceOf(OhlcAggregation);
  });
});
