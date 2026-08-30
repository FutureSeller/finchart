import type { OHLC } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { heikinAshi } from "../heikin-ashi";

function candle(
  x: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume?: number,
): OHLC {
  return { x, open, high, low, close, volume };
}

describe("heikinAshi", () => {
  it("should seed the first bar's open from the raw open/close average", () => {
    const [first] = heikinAshi([candle(0, 10, 12, 8, 11)]);
    // open = (10+11)/2 = 10.5, close = (10+12+8+11)/4 = 10.25
    expect(first.open).toBeCloseTo(10.5);
    expect(first.close).toBeCloseTo(10.25);
  });

  it("should carry the previous HA open/close into the next open (stateful)", () => {
    const out = heikinAshi([
      candle(0, 10, 12, 8, 11), // HA: open 10.5, close 10.25
      candle(1, 11, 14, 10, 13), // next open = (10.5+10.25)/2 = 10.375
    ]);

    expect(out[1].open).toBeCloseTo(10.375);
    // close = (11+14+10+13)/4 = 12
    expect(out[1].close).toBeCloseTo(12);
  });

  it("should widen high/low to cover both the raw range and the HA body", () => {
    // HA open/close land inside the raw range here — high/low stay raw.
    const [bar] = heikinAshi([candle(0, 10, 20, 5, 12)]);
    expect(bar.high).toBe(20);
    expect(bar.low).toBe(5);
  });

  it("should inherit x and volume unchanged", () => {
    const out = heikinAshi([candle(5, 10, 12, 8, 11, 999)]);
    expect(out[0].x).toBe(5);
    expect(out[0].volume).toBe(999);
  });

  it("should not require a lookahead — output length matches input", () => {
    const source = Array.from({ length: 10 }, (_, i) =>
      candle(i, 100 + i, 105 + i, 95 + i, 102 + i),
    );
    expect(heikinAshi(source)).toHaveLength(10);
  });

  it("should handle an empty source", () => {
    expect(heikinAshi([])).toEqual([]);
  });
});
