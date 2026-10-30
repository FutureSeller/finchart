import { createPlotModel, lineSeries, manualScheduler } from "@finchart/core";
import type { OHLC } from "@finchart/core";
import { describe, expect, it, vi } from "vitest";
import { baseX, followWindow, formatPercent, percentFrom } from "../compare";

// Distinct open, high and low, so reading any of them instead of close shows.
const bar = (x: number, close: number): OHLC => ({ x, open: close + 1, high: close + 2, low: close - 2, close });

describe("percentFrom", () => {
  const candles = [bar(0, 80), bar(1, 100), bar(2, 110), bar(3, 90)];

  it("is 0 at the base bar and the close's percent change from it elsewhere", () => {
    const line = percentFrom(candles, 1);
    expect(line.map((point) => point.x)).toEqual([0, 1, 2, 3]);
    expect(line[1].y).toBe(0);
    expect(line[0].y).toBeCloseTo(-20);
    expect(line[2].y).toBeCloseTo(10);
    expect(line[3].y).toBeCloseTo(-10);
  });

  it("is a ratio of closes, not a difference", () => {
    const fromFirst = percentFrom(candles, 0).map((point) => point.y);
    expect(fromFirst[0]).toBe(0);
    expect(fromFirst[1]).toBeCloseTo(25);
    expect(fromFirst[2]).toBeCloseTo(37.5);
    expect(fromFirst[3]).toBeCloseTo(12.5);
  });

  it("takes the first bar at or after a base x that falls between bars", () => {
    expect(percentFrom(candles, 1.5)[2].y).toBe(0);
  });

  it("takes the last bar for a base x past the data, and gives nothing for no data", () => {
    expect(percentFrom(candles, 9)[3].y).toBe(0);
    expect(percentFrom([], 0)).toEqual([]);
  });
});

describe("baseX", () => {
  const candles = [bar(10, 1), bar(20, 1), bar(30, 1)];

  it("is the first bar's x at or after the window's start, or the last bar's past it", () => {
    expect(baseX(candles, 0)).toBe(10);
    expect(baseX(candles, 20)).toBe(20);
    expect(baseX(candles, 21)).toBe(30);
    expect(baseX(candles, 99)).toBe(30);
    expect(baseX([], 5)).toBeNull();
  });
});

describe("formatPercent", () => {
  it("signs a gain, keeps a loss's own sign, leaves zero bare, and takes its decimals from the tick step", () => {
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-1.234)).toBe("-1.23%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(0.123, 0.005)).toBe("+0.123%");
  });
});

describe("followWindow", () => {
  const MINUTE = 60_000;
  const walk = (step: number) =>
    Array.from({ length: 300 }, (_, i) => bar(i * MINUTE, 100 + step * Math.sin(i / 9) + i * 0.1));

  function setup() {
    const scheduler = manualScheduler();
    const model = createPlotModel<{ x: number; y: number }>({
      size: { width: 600, height: 300 },
      deps: { createScheduler: scheduler },
    });
    const symbols = [walk(5), walk(-7)].map((candles) => ({
      candles,
      line: model.plot.mainPane.addSeries({ series: lineSeries(), data: percentFrom(candles, candles[0].x) }),
    }));
    scheduler.created[0].flush();
    const off = followWindow(model.plot, symbols);
    return { plot: model.plot, symbols, off };
  }

  it("measures every line from the window's first bar and keeps the window", () => {
    const { plot, symbols, off } = setup();
    plot.setVisibleRange(200 * MINUTE, 299 * MINUTE);
    for (const { line } of symbols) expect(line.read()[200].y).toBe(0);
    expect(symbols[0].line.read()[250].y).not.toBe(symbols[1].line.read()[250].y);
    expect(plot.getVisibleRange()?.min).toBe(200 * MINUTE);
    off();
    plot.destroy();
  });

  it("replaces nothing for a window that starts on the same bar, and nothing once unsubscribed", () => {
    const { plot, symbols, off } = setup();
    // Both starts fall between bars 199 and 200, so both pick bar 200.
    plot.setVisibleRange(199.5 * MINUTE, 299 * MINUTE);
    const spies = symbols.map(({ line }) => vi.spyOn(line, "setData"));
    plot.setVisibleRange(199.8 * MINUTE, 299 * MINUTE);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    off();
    plot.setVisibleRange(100 * MINUTE, 299 * MINUTE);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    plot.destroy();
  });
});
