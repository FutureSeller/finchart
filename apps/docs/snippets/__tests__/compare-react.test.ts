/**
 * The compare page's React recipe carries its own copy of the percent-change
 * helpers so a reader can copy the file whole; this runs that copy. The
 * component's state wiring is held by the type-check only: these tests run
 * without a DOM to render it in.
 */
import type { OHLC } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { baseX, formatPercent, percentFrom } from "../compare-react";

// Distinct open, high and low, so reading any of them instead of close shows.
const bar = (x: number, close: number): OHLC => ({ x, open: close + 1, high: close + 2, low: close - 2, close });

describe("the compare recipe's helpers", () => {
  const candles = [bar(0, 80), bar(1, 100), bar(2, 110), bar(3, 90)];

  it("measures each close from the bar at the base x, as percent change", () => {
    expect(baseX(candles, 1)).toBe(1);
    expect(percentFrom(candles, 1)[1].y).toBe(0);
    const fromFirst = percentFrom(candles, 0).map((point) => point.y);
    expect(fromFirst[0]).toBe(0);
    expect(fromFirst[1]).toBeCloseTo(25);
    expect(fromFirst[2]).toBeCloseTo(37.5);
    expect(fromFirst[3]).toBeCloseTo(12.5);
  });

  it("measures each close from the first bar at or after the base x", () => {
    const line = percentFrom(candles, 0.5);
    expect(line.map((point) => point.x)).toEqual([0, 1, 2, 3]);
    expect(line[1].y).toBe(0);
    expect(line[0].y).toBeCloseTo(-20);
    expect(line[2].y).toBeCloseTo(10);
  });

  it("takes the last bar past the data, and nothing with no data", () => {
    expect(baseX(candles, 9)).toBe(3);
    expect(percentFrom(candles, 9)[3].y).toBe(0);
    expect(baseX([], 0)).toBeNull();
    expect(percentFrom([], 0)).toEqual([]);
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
