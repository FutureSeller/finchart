/**
 * Enforces "a Series must be stateless" mechanically. This contract is
 * why `swapSeries` can swap out the representation and `SeriesSpec` can
 * accept a fresh instance on every render, but it lived only in prose,
 * with no machine holding it to account. `command-purity.test.ts` checks
 * that commands are pure data, not that a series is deterministic.
 *
 * What this locks down is the observable side of that contract: drawing
 * the same stage twice must produce byte-identical commands. A counter
 * that ticks on every draw, a cache that remembers the previous frame,
 * state that depends on call order — all of it gets caught here.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { createPlotModel } from "../../plot/model";
import {
  areaSeries,
  barSeries,
  baselineSeries,
  candleSeries,
  histogramSeries,
  lineSeries,
} from "..";
import type { Series } from "..";

const line: LineDataPoint[] = Array.from({ length: 40 }, (_, i) => ({
  x: i,
  // Insert one hole — the hole-splitting path must be deterministic too.
  y: i === 17 ? null : 100 + Math.sin(i / 3) * 10,
}));

const candles: OHLC[] = Array.from({ length: 40 }, (_, i) => ({
  x: i,
  open: 100 + i,
  high: 104 + i,
  low: 98 + i,
  close: 102 + (i % 3),
}));

interface Case {
  name: string;
  series: () => Series<LineDataPoint> | Series<OHLC>;
  data: LineDataPoint[] | OHLC[];
}

const CASES: Case[] = [
  { name: "lineSeries", series: () => lineSeries(), data: line },
  { name: "areaSeries", series: () => areaSeries(), data: line },
  {
    name: "baselineSeries",
    series: () => baselineSeries({ baseline: 100 }),
    data: line,
  },
  { name: "histogramSeries", series: () => histogramSeries(), data: line },
  { name: "candleSeries", series: () => candleSeries(), data: candles },
  { name: "barSeries", series: () => barSeries(), data: candles },
];

describe("drawing the same stage twice produces the same commands", () => {
  it.each(CASES)("$name", ({ series, data }) => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: series() as Series<never>, data: data as never[] },
      config: { showGrid: false },
    });

    model.plot.render();
    const first = model.commands();

    model.plot.render();
    const second = model.commands();

    // Two frames with nothing changed — any state would diverge here.
    expect(second).toEqual(first);
    expect(second.length).toBeGreaterThan(0);
  });

  /**
   * Still matches even when the instance is swapped out — the basis for
   * `SeriesSpec` accepting a fresh series on every render while
   * `syncSeries` just swaps the reference.
   */
  it.each(CASES)("$name — a fresh instance draws the same picture", ({ series, data }) => {
    const draw = (make: () => Series<never>) => {
      const model = createPlotModel({
        size: { width: 400, height: 300 },
        series: { series: make(), data: data as never[] },
        config: { showGrid: false },
      });
      model.plot.render();
      return model.commands();
    };

    expect(draw(series as () => Series<never>)).toEqual(
      draw(series as () => Series<never>),
    );
  });
});
