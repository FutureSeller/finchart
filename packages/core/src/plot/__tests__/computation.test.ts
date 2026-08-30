/**
 * The computation node. One computation, N drawings — MACD is three lines,
 * and attaching a derive to every series would run the same EMA three
 * times. Decimation caps per-frame cost, but nothing caps the first
 * computation. References are values, not string ids.
 */
import { describe, expect, it } from "vitest";
import { computation, type LineDataPoint, type OHLC } from "../../data";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const candles = (count: number): OHLC[] =>
  Array.from({ length: count }, (_, i) => ({
    x: i,
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
  }));

/** Produces three branches from candles. The shape of MACD. */
const threeWays = (source: OHLC[]) => ({
  fast: source.map((c) => ({ x: c.x, y: c.close })),
  slow: source.map((c) => ({ x: c.x, y: c.close / 2 })),
  histogram: source.map((c) => ({ x: c.x, y: c.close / 4 })),
});

function stage() {
  const deps = testBrowserDeps();
  const { plot } = mountPlot<OHLC>({
    deps,
    config: { ...defaultConfig, showGrid: false },
  });

  return { plot, deps };
}

describe("computation", () => {
  it("should run once no matter how many outputs are drawn", () => {
    const { plot } = stage();
    let runs = 0;

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(10),
    });
    const node = computation({
      inputs: [price],
      calc: (source: OHLC[]) => {
        runs += 1;
        return threeWays(source);
      },
    });

    const lower = plot.addPane();
    lower.addSeries({ series: lineSeries(), input: node.out.fast });
    lower.addSeries({ series: lineSeries(), input: node.out.slow });
    lower.addSeries({ series: lineSeries(), input: node.out.histogram });
    plot.render();
    plot.render();

    // Runs once at creation (to discover the branch names), and the input stays unchanged after that.
    expect(runs).toBe(1);
  });

  it("should recompute once when the input changes, not once per output", () => {
    const { plot } = stage();
    let runs = 0;

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(10),
    });
    const node = computation({
      inputs: [price],
      calc: (source: OHLC[]) => {
        runs += 1;
        return threeWays(source);
      },
    });

    const lower = plot.addPane();
    lower.addSeries({ series: lineSeries(), input: node.out.fast });
    lower.addSeries({ series: lineSeries(), input: node.out.slow });
    lower.addSeries({ series: lineSeries(), input: node.out.histogram });
    plot.render();
    const before = runs;

    price.append(candles(11).slice(10));
    plot.render();

    expect(runs - before).toBe(1);
  });

  it("should draw what the output produced", () => {
    const { plot } = stage();

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(10),
    });
    const node = computation({ inputs: [price], calc: threeWays });

    const lower = plot.addPane();
    const drawn = lower.addSeries({
      series: lineSeries(),
      input: node.out.slow,
    });

    // close/2 — the branch is drawn, not the source.
    expect(drawn.read().map((p) => p.y)).toEqual(
      candles(10).map((c) => c.close / 2),
    );
    expect(drawn.xRange).toEqual({ min: 0, max: 9 });
  });

  it("should follow its input without anyone wiring an update", () => {
    const { plot } = stage();

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(10),
    });
    const node = computation({ inputs: [price], calc: threeWays });
    const drawn = plot
      .addPane()
      .addSeries({ series: lineSeries(), input: node.out.fast });

    price.append(candles(20).slice(10));

    // It's pull-based, so there's no subscription — asking is what makes it current.
    expect(drawn.xRange).toEqual({ min: 0, max: 19 });
  });

  it("should take another computation as input", () => {
    const { plot } = stage();

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(10),
    });
    const first = computation({ inputs: [price], calc: threeWays });
    const second = computation({
      inputs: [first.out.fast],
      calc: (points: LineDataPoint[]) => ({
        doubled: points.map((p) => ({ x: p.x, y: (p.y ?? 0) * 2 })),
      }),
    });

    const drawn = plot
      .addPane()
      .addSeries({ series: lineSeries(), input: second.out.doubled });

    expect(drawn.read().map((p) => p.y)).toEqual(
      candles(10).map((c) => c.close * 2),
    );
  });

  it("should read several inputs in the order they were given", () => {
    const { plot } = stage();

    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(4),
    });
    const other = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(1),
    });

    const node = computation({
      inputs: [price, other],
      calc: (first: OHLC[], second: OHLC[]) => ({
        merged: [{ x: 0, y: first.length + second.length }] as LineDataPoint[],
      }),
    });

    expect(node.out.merged.read()).toEqual([{ x: 0, y: 5 }]);
  });
});

describe("a registration that does not own its data", () => {
  /** A combination error is caught at compile time — when the registration type was flat, giving both input and data used to pass. */
  it("should refuse data and input together", () => {
    const { plot } = stage();
    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(4),
    });
    const node = computation({ inputs: [price], calc: threeWays });

    // @ts-expect-error: giving input rules out also giving data
    plot.addPane().addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 1 }],
      input: node.out.fast,
    });
  });

  it("should refuse setData on an input-backed handle", () => {
    const { plot } = stage();
    const price = plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles(4),
    });
    const node = computation({ inputs: [price], calc: threeWays });
    const drawn = plot
      .addPane()
      .addSeries({ series: lineSeries(), input: node.out.fast });

    // What gets swapped out is the input, not this registration.
    expect(() => drawn.setData([{ x: 0, y: 1 }])).toThrow(/doesn't own its data/);
  });
});
