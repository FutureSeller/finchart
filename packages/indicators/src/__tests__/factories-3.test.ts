/**
 * CCI, Williams %R, Donchian, Keltner, SuperTrend. Pin exact values with
 * small scripts that can be checked by hand.
 */
import type { OHLC, Source } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  cci,
  donchianChannels,
  keltnerChannels,
  pivotPoints,
  superTrend,
  williamsR,
} from "../factories";
import { meanAbsDeviation } from "../kernels";

function candle(x: number, close: number): OHLC {
  return { x, open: close, high: close + 1, low: close - 1, close };
}

function bar(x: number, high: number, low: number, close: number): OHLC {
  return { x, open: close, high, low, close };
}

function sourceOf(candles: OHLC[]): Source<OHLC> {
  return { read: () => candles };
}

describe("meanAbsDeviation", () => {
  it("should average absolute distance from the window mean", () => {
    // window [10,20,30]: mean 20, deviation (10+0+10)/3 = 20/3
    const out = meanAbsDeviation([10, 20, 30], 3);
    expect(out).toEqual([null, null, 20 / 3]);
  });

  it("should stay null while the window has holes — sma's rule", () => {
    // last window [30,40,50]: mean 40, deviation (10+0+10)/3 = 20/3
    expect(meanAbsDeviation([10, null, 30, 40, 50], 3)).toEqual([
      null,
      null,
      null,
      null,
      20 / 3,
    ]);
  });
});

describe("cci", () => {
  it("should center at zero on a flat-deviation tape and inherit x", () => {
    // typical price 10, 20, 30 (the candle helper sets high/low to ±1, so
    // typical price equals close).
    // sma=20, mad=20/3 → cci = (30−20)/(0.015×20/3) = 100
    const source = sourceOf([candle(0, 10), candle(1, 20), candle(2, 30)]);

    const out = cci(source, { period: 3 }).out.cci.read();

    expect(out.map((point) => point.x)).toEqual([0, 1, 2]);
    expect(out[0].y).toBeNull();
    expect(out[1].y).toBeNull();
    expect(out[2].y).toBeCloseTo(100, 8);
  });

  it("should be null when the deviation is zero — a flat tape divides by nothing", () => {
    const source = sourceOf([candle(0, 10), candle(1, 10), candle(2, 10)]);

    const out = cci(source, { period: 3 }).out.cci.read();

    expect(out[2].y).toBeNull();
  });
});

describe("williamsR", () => {
  it("should read 0 at the top and -100 at the bottom of the window", () => {
    const tape = [bar(0, 10, 0, 5), bar(1, 10, 0, 10), bar(2, 10, 0, 0)];
    const source = sourceOf(tape);

    const out = williamsR(source, { period: 2 }).out.r.read();

    expect(out[0].y).toBeNull(); // warmup
    expect(out[1].y).toBe(0); // close = window high
    expect(out[2].y).toBe(-100); // close = window low
  });

  it("should be null when the window has no range", () => {
    const flat = [bar(0, 5, 5, 5), bar(1, 5, 5, 5)];

    const out = williamsR(sourceOf(flat), { period: 2 }).out.r.read();

    expect(out[1].y).toBeNull();
  });
});

describe("donchianChannels", () => {
  it("should track window extremes and their midpoint, band included", () => {
    const tape = [bar(0, 10, 2, 5), bar(1, 8, 4, 6), bar(2, 20, 6, 15)];
    const node = donchianChannels(sourceOf(tape), { period: 2 });

    const upper = node.out.upper.read();
    const lower = node.out.lower.read();
    const middle = node.out.middle.read();
    const band = node.out.band.read();

    expect(upper.map((point) => point.y)).toEqual([null, 10, 20]);
    expect(lower.map((point) => point.y)).toEqual([null, 2, 4]);
    expect(middle[2].y).toBe(12);
    expect(band[2]).toEqual({ x: 2, upper: 20, lower: 4 });
  });
});

describe("keltnerChannels", () => {
  it("should wrap the ema middle with rma(TR) width", () => {
    // second bar: the high-low range is 2, but the gap (prior close 10 →
    // high 13) makes TR = 3.
    // with period 1, ema = close and rma = TR as-is → upper = 12 + 2×3.
    const source = sourceOf([candle(0, 10), candle(1, 12)]);
    const node = keltnerChannels(source, {
      period: 1,
      atrPeriod: 1,
      multiplier: 2,
    });

    expect(node.out.middle.read().map((point) => point.y)).toEqual([10, 12]);
    expect(node.out.upper.read()[1].y).toBe(18);
    expect(node.out.lower.read()[1].y).toBe(6);
  });
});

describe("superTrend", () => {
  const uptape = [
    bar(0, 11, 9, 10),
    bar(1, 12, 10, 11),
    bar(2, 13, 11, 12),
    bar(3, 14, 12, 13),
  ];

  it("should ride an uptrend on the up branch and keep the down branch null", () => {
    const node = superTrend(sourceOf(uptape), { period: 1, multiplier: 1 });

    const up = node.out.up.read();
    const down = node.out.down.read();

    // with period 1 it's valid from the first bar. This is an uptrend
    // script, so only up has values.
    expect(up.every((point, i) => (i === 0 ? true : point.y !== null))).toBe(true);
    expect(down.every((point) => point.y === null)).toBe(true);
  });

  it("should ratchet — the support line never steps down while the trend holds", () => {
    const node = superTrend(sourceOf(uptape), { period: 1, multiplier: 1 });
    const up = node.out.up
      .read()
      .map((point) => point.y)
      .filter((y): y is number => y !== null);

    for (let i = 1; i < up.length; i++) {
      expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    }
  });

  it("should flip to the down branch when the close breaks the support", () => {
    const tape = [
      bar(0, 11, 9, 10),
      bar(1, 12, 10, 11),
      bar(2, 11, 3, 4), // support line (previous finalLower) breaks
    ];
    const node = superTrend(sourceOf(tape), { period: 1, multiplier: 1 });

    const up = node.out.up.read();
    const down = node.out.down.read();

    expect(up[1].y).not.toBeNull();
    expect(up[2].y).toBeNull(); // up cuts off starting at the reversal bar
    expect(down[2].y).not.toBeNull(); // the resistance line starts
  });
});

describe("pivotPoints", () => {
  // period = 2 bars. First period H4 L0 C2 → P=2, R1=4, S1=0, R2=6,
  // S2=-2, R3=8, S3=-4
  const tape = [
    bar(0, 4, 0, 1),
    bar(1, 3, 1, 2),
    bar(2, 5, 2, 3), // new period — the boundary bar is null (a gap that
    // breaks the diagonal connecting line)
    bar(3, 6, 3, 5),
  ];
  const anchor = (_: OHLC, index: number) => index % 2 === 0;

  it("should level the classic floor formula from the previous period", () => {
    const node = pivotPoints(sourceOf(tape), { anchor });

    expect(node.out.p.read().map((point) => point.y)).toEqual([null, null, null, 2]);
    expect(node.out.r1.read()[3].y).toBe(4);
    expect(node.out.s1.read()[3].y).toBe(0);
    expect(node.out.r2.read()[3].y).toBe(6);
    expect(node.out.s2.read()[3].y).toBe(-2);
    expect(node.out.r3.read()[3].y).toBe(8);
    expect(node.out.s3.read()[3].y).toBe(-4);
  });

  it("should stay null through the whole first period — no previous period exists", () => {
    const node = pivotPoints(sourceOf(tape), { anchor });
    const p = node.out.p.read();

    expect(p[0].y).toBeNull();
    expect(p[1].y).toBeNull();
  });
});

describe("superTrend initial direction", () => {
  it("should seed from the first valid bar — a downtrend starts on the down branch", () => {
    const downtape = [
      bar(0, 11, 9, 9.5), // close < midpoint (10) — seeds a downtrend
      bar(1, 10, 8, 8.5),
      bar(2, 9, 7, 7.5),
    ];
    const node = superTrend(sourceOf(downtape), { period: 1, multiplier: 1 });

    expect(node.out.up.read().every((point) => point.y === null)).toBe(true);
    expect(node.out.down.read()[0].y).not.toBeNull();
  });
});
