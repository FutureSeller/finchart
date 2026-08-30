import type { LineDataPoint, OHLC, Source } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  MACD_DEFAULTS,
  STOCHASTIC_DEFAULTS,
  adx,
  atr,
  bollingerBands,
  ichimoku,
  macd,
  movingAverage,
  obv,
  parabolicSar,
  rsi,
  stochastic,
  vwap,
} from "../factories";

function candle(x: number, close: number): OHLC {
  return { x, open: close, high: close + 1, low: close - 1, close };
}

function sourceOf(candles: OHLC[]): Source<OHLC> & { swap(next: OHLC[]): void } {
  let data = candles;
  return {
    read: () => data,
    swap(next) {
      data = next;
    },
  };
}

describe("movingAverage", () => {
  it("should inherit x and mark the warmup as whitespace", () => {
    const source = sourceOf([candle(0, 10), candle(1, 20), candle(2, 30)]);

    const ma = movingAverage(source, { period: 3 }).out.ma.read();

    expect(ma.map((point) => point.x)).toEqual([0, 1, 2]);
    expect(ma.map((point) => point.y)).toEqual([null, null, 20]);
  });

  it("should read a custom value accessor", () => {
    const source: Source<{ x: number; volume: number }> = {
      read: () => [
        { x: 0, volume: 10 },
        { x: 1, volume: 20 },
      ],
    };

    const ma = movingAverage(source, {
      period: 2,
      value: (point) => point.volume,
    }).out.ma.read();

    expect(ma[1].y).toBe(15);
  });

  it("should feed another indicator — ma of ma", () => {
    const source = sourceOf(
      Array.from({ length: 6 }, (_, i) => candle(i, (i + 1) * 10)),
    );

    const ma2 = movingAverage(source, { period: 2 });
    const smoothed = movingAverage(ma2.out.ma, {
      period: 2,
      value: (point) => point.y,
    });

    const out = smoothed.out.ma.read();
    // ma2: [null,15,25,35,45,55] → ma of that: the first two are null,
    // then 20.
    expect(out.map((point) => point.y)).toEqual([null, null, 20, 30, 40, 50]);
  });

  it("should switch to the exponential kernel with type", () => {
    const source = sourceOf([
      candle(0, 2),
      candle(1, 4),
      candle(2, 6),
      candle(3, 12),
    ]);

    const out = movingAverage(source, { period: 3, type: "ema" }).out.ma.read();

    // seed (2+4+6)/3 = 4, next 12*0.5 + 4*0.5 = 8 — with sma it would
    // be 22/3.
    expect(out.map((point) => point.y)).toEqual([null, null, 4, 8]);
  });
});

describe("macd", () => {
  const trending = Array.from({ length: 60 }, (_, i) => candle(i, 100 + i));

  it("should run the calculation once for all three branches", () => {
    let reads = 0;
    const source = sourceOf(trending);

    const node = macd(source, {
      fast: 3,
      slow: 6,
      signal: 3,
      value: (point: OHLC) => {
        reads++;
        return point.close;
      },
    });

    node.out.macd.read();
    node.out.signal.read();
    node.out.histogram.read();

    // Reading all three branches still costs one pass over the values —
    // proof the calculation runs once (C1).
    expect(reads).toBe(trending.length);
  });

  it("should recalculate exactly once when the input changes", () => {
    let reads = 0;
    const source = sourceOf(trending);
    const node = macd(source, {
      fast: 3,
      slow: 6,
      signal: 3,
      value: (point: OHLC) => {
        reads++;
        return point.close;
      },
    });
    node.out.macd.read();
    reads = 0;

    // Tail append — when the resume path kicks in, only the tail is read.
    source.swap([...trending, candle(60, 160)]);
    node.out.macd.read();
    node.out.histogram.read();
    expect(reads).toBe(1);

    // A non-tail change (all new objects) is still a full recalculation —
    // but only once across all three branches.
    reads = 0;
    source.swap(trending.map((c) => ({ ...c })));
    node.out.macd.read();
    node.out.histogram.read();
    expect(reads).toBe(trending.length);
  });

  it("should hold macd = signal = 0-ish histogram on a linear trend", () => {
    const source = sourceOf(trending);
    const node = macd(source, { fast: 3, slow: 6, signal: 3 });

    const line = node.out.macd.read();
    const histogram = node.out.histogram.read();

    // On an arithmetic sequence, the difference between the two EMAs
    // converges to a constant → the histogram goes to 0.
    expect(line.at(-1)!.y).toBeCloseTo(line.at(-2)!.y!, 3);
    expect(histogram.at(-1)!.y).toBeCloseTo(0, 3);
  });

  it("should keep the same branch keys before data arrives", () => {
    const node = macd(sourceOf([]));

    // The branches stand even with empty input — the contract is that
    // keys are fixed at the first calculation.
    expect(node.out.macd.read()).toEqual([]);
    expect(node.out.signal.read()).toEqual([]);
    expect(node.out.histogram.read()).toEqual([]);
  });
});

describe("bollingerBands", () => {
  it("should straddle the middle symmetrically", () => {
    const source = sourceOf([
      candle(0, 2),
      candle(1, 4),
      candle(2, 4),
      candle(3, 4),
      candle(4, 5),
      candle(5, 5),
      candle(6, 7),
      candle(7, 9),
    ]);

    const node = bollingerBands(source, { period: 8, multiplier: 2 });
    const upper = node.out.upper.read().at(-1)!.y!;
    const middle = node.out.middle.read().at(-1)!.y!;
    const lower = node.out.lower.read().at(-1)!.y!;

    // A well-known example — mean 5, standard deviation 2.
    expect(middle).toBe(5);
    expect(upper).toBeCloseTo(9, 10);
    expect(lower).toBeCloseTo(1, 10);
  });

  it("should pack both edges into the band branch", () => {
    const source = sourceOf([candle(0, 4), candle(1, 6)]);

    const band = bollingerBands(source, { period: 2 }).out.band.read();

    expect(band[0]).toEqual({ x: 0, upper: null, lower: null });
    expect(band[1].upper).toBeCloseTo(7, 10);
    expect(band[1].lower).toBeCloseTo(3, 10);
  });
});

function ohlc(
  x: number,
  high: number,
  low: number,
  close: number,
): OHLC {
  return { x, open: close, high, low, close };
}

describe("rsi", () => {
  it("should follow Wilder's smoothing by hand", () => {
    const source = sourceOf([
      candle(0, 10),
      candle(1, 11),
      candle(2, 10),
      candle(3, 12),
    ]);

    const out = rsi(source, { period: 2 }).out.rsi.read();

    // changes: +1, -1, +2 → the avgGain/avgLoss seed lands at idx2.
    expect(out[0].y).toBeNull();
    expect(out[1].y).toBeNull();
    expect(out[2].y).toBeCloseTo(50);
    // avgGain = (0.5+2)/2 = 1.25, avgLoss = 0.5/2 = 0.25 → RS 5.
    expect(out[3].y).toBeCloseTo(100 - 100 / 6);
  });

  it("should read 100 when nothing ever falls", () => {
    const source = sourceOf([1, 2, 3, 4].map((v, i) => candle(i, v)));

    const out = rsi(source, { period: 2 }).out.rsi.read();

    expect(out[2].y).toBe(100);
    expect(out[3].y).toBe(100);
  });
});

describe("atr", () => {
  it("should average the true range with prev close in reach", () => {
    const source = sourceOf([
      ohlc(0, 12, 8, 10), // TR₀ = high − low = 4
      ohlc(1, 15, 11, 14), // max(4, |15−10|, |11−10|) = 5
      ohlc(2, 16, 13, 13), // max(3, |16−14|, |13−14|) = 3
    ]);

    const out = atr(source, { period: 2 }).out.atr.read();

    expect(out[0].y).toBeNull();
    expect(out[1].y).toBeCloseTo(4.5); // seed (4+5)/2
    expect(out[2].y).toBeCloseTo(3.75); // (4.5 + 3) / 2
  });
});

describe("stochastic", () => {
  it("should place the close inside the window range", () => {
    const source = sourceOf([
      ohlc(0, 10, 0, 5),
      ohlc(1, 10, 0, 8),
      ohlc(2, 5, 5, 5),
      ohlc(3, 5, 5, 5),
    ]);

    const { k, d } = stochastic(source, {
      period: 2,
      smooth: 1,
      signal: 1,
    }).out;
    const kValues = k.read().map((point) => point.y);

    expect(kValues[0]).toBeNull(); // the window hasn't filled yet
    expect(kValues[1]).toBeCloseTo(80); // (8−0)/10
    expect(kValues[2]).toBeCloseTo(50); // (5−0)/10
    // The high and low inside the window are equal — neither 0 nor 100,
    // there's no value at all.
    expect(kValues[3]).toBeNull();
    // With smooth = signal = 1, %D equals %K.
    expect(d.read().map((point) => point.y)).toEqual(kValues);
  });
});

function traded(x: number, close: number, volume?: number): OHLC {
  return { x, open: close, high: close + 1, low: close - 1, close, volume };
}

describe("vwap", () => {
  it("should weight the typical price by volume", () => {
    const source = sourceOf([
      { x: 0, open: 10, high: 12, low: 8, close: 10, volume: 10 }, // typical price 10
      { x: 1, open: 20, high: 22, low: 18, close: 20, volume: 30 }, // typical price 20
    ]);

    const out = vwap(source).out.vwap.read();

    expect(out[0].y).toBeCloseTo(10);
    expect(out[1].y).toBeCloseTo((10 * 10 + 20 * 30) / 40); // 17.5
  });

  it("should go null from a missing volume to the end — D1", () => {
    const source = sourceOf([traded(0, 10, 5), traded(1, 11), traded(2, 12, 7)]);

    const out = vwap(source).out.vwap.read();

    // Skipping ahead and carrying the accumulation forward would fake
    // having a value — instead everything from that bar on is null.
    expect(out.map((point) => point.y !== null)).toEqual([true, false, false]);
  });

  it("should come back to life at an anchor — a reset owes the broken bar nothing", () => {
    const source = sourceOf([
      traded(0, 10, 5),
      traded(1, 11),
      traded(2, 12, 7),
      traded(3, 13, 3),
    ]);

    const out = vwap(source, { anchor: (_, index) => index === 2 }).out.vwap.read();

    expect(out[1].y).toBeNull();
    expect(out[2].y).toBeCloseTo(12); // fresh accumulation — just one typical price, 12
    expect(out[3].y).not.toBeNull();
  });
});

describe("obv", () => {
  it("should accumulate signed volume from vol₀", () => {
    const source = sourceOf([
      traded(0, 10, 5),
      traded(1, 12, 3), // went up +3
      traded(2, 11, 4), // went down -4
      traded(3, 11, 7), // unchanged — neither added nor subtracted
    ]);

    const out = obv(source).out.obv.read();

    expect(out.map((point) => point.y)).toEqual([5, 8, 4, 4]);
  });

  it("should go null from a missing volume to the end — no anchor to revive it", () => {
    const source = sourceOf([traded(0, 10, 5), traded(1, 11), traded(2, 12, 7)]);

    const out = obv(source).out.obv.read();

    expect(out.map((point) => point.y)).toEqual([5, null, null]);
  });
});

describe("adx", () => {
  it("should smooth DM and TR into DI and DX by hand", () => {
    const source = sourceOf([
      ohlc(0, 10, 5, 7),
      ohlc(1, 12, 6, 11), // +DM 2, -DM 0, TR 6
      ohlc(2, 14, 8, 13), // +DM 2, -DM 0, TR 6
      ohlc(3, 13, 7, 8), // +DM 0, -DM 1, TR 6
    ]);

    const node = adx(source, { period: 2 });
    const plusDi = node.out.plusDi.read().map((point) => point.y);
    const minusDi = node.out.minusDi.read().map((point) => point.y);
    const line = node.out.adx.read().map((point) => point.y);

    expect(plusDi[2]).toBeCloseTo(100 / 3);
    expect(plusDi[3]).toBeCloseTo(100 / 6);
    expect(minusDi[2]).toBe(0);
    expect(minusDi[3]).toBeCloseTo(100 / 12);
    // double warmup — even after DI is established, DX's rma seed still
    // has to wait again.
    expect(line[2]).toBeNull();
    expect(line[3]).toBeCloseTo(200 / 3);
  });
});

describe("ichimoku", () => {
  it("should shift by index, never inventing an x — D3", () => {
    const source = sourceOf([
      ohlc(0, 10, 0, 5),
      ohlc(1, 20, 10, 15),
      ohlc(2, 30, 20, 25),
    ]);

    const node = ichimoku(source, {
      conversion: 1,
      base: 2,
      span: 2,
      displacement: 1,
    });
    const read = (branch: Source<LineDataPoint>) =>
      branch.read().map((point) => point.y);

    expect(read(node.out.conversion)).toEqual([5, 15, 25]); // (high+low)/2
    expect(read(node.out.base)).toEqual([null, 10, 20]);
    // leading span — yesterday's value lands in today's slot. Every x
    // still belongs to real data.
    expect(read(node.out.spanA)).toEqual([null, null, 12.5]);
    expect(read(node.out.spanB)).toEqual([null, null, 10]);
    // lagging span — tomorrow's close lands in today's slot. The end has
    // no future, so it's null.
    expect(read(node.out.lagging)).toEqual([15, 25, null]);
    expect(node.out.spanA.read().map((point) => point.x)).toEqual([0, 1, 2]);
  });

  it("should pack the cloud as a band branch", () => {
    const source = sourceOf([
      ohlc(0, 10, 0, 5),
      ohlc(1, 20, 10, 15),
      ohlc(2, 30, 20, 25),
    ]);

    const cloud = ichimoku(source, {
      conversion: 1,
      base: 2,
      span: 2,
      displacement: 1,
    }).out.cloud.read();

    expect(cloud[2]).toEqual({ x: 2, upper: 12.5, lower: 10 });
  });
});

describe("parabolicSar", () => {
  it("should trail an uptrend and jump above on reversal", () => {
    const source = sourceOf([
      ohlc(0, 10, 8, 9),
      ohlc(1, 11, 9, 10),
      ohlc(2, 12, 10, 11),
      ohlc(3, 6, 4, 5), // collapse — the low breaks through the SAR
    ]);

    const out = parabolicSar(source, { step: 0.5, max: 0.5 })
      .out.sar.read()
      .map((point) => point.y);

    expect(out[0]).toBeNull(); // no previous bar to establish a trend
    // the low clamp from the previous two bars holds at 8.
    expect(out[1]).toBe(8);
    expect(out[2]).toBe(8);
    // the reversal bar's SAR = the previous EP (12) — it jumps above price.
    expect(out[3]).toBe(12);
  });
});

describe("defaults single source", () => {
  it("should make the exported defaults be the real defaults", () => {
    // The omitted call and the explicit-constants call must match for the
    // constants to be the "real" defaults — since the labels (plugins)
    // read these constants, this equivalence is what keeps the labels
    // honest.
    const candles = Array.from({ length: 80 }, (_, i) =>
      candle(i, 100 + Math.sin(i / 3) * 10),
    );
    const source = sourceOf(candles);

    const omitted = macd(source).out.macd.read();
    const explicit = macd(source, MACD_DEFAULTS).out.macd.read();
    expect(omitted).toEqual(explicit);

    const kOmitted = stochastic(source).out.k.read();
    const kExplicit = stochastic(source, STOCHASTIC_DEFAULTS).out.k.read();
    expect(kOmitted).toEqual(kExplicit);
  });
});

/**
 * Equivalence of the tail-resume path. Since `calc` and `calcLast` come
 * from the same fold, their results must never diverge — this checks that
 * a node fed a tick sequence agrees with a fresh node that recalculates
 * from scratch every time. macd is a case where three folds (fast, slow,
 * signal) carry separate checkpoints — since signal's input is the output
 * (the macd line) of the other two folds, resume has to treat the three
 * as one atomic unit.
 */
describe("macd — tail-door equivalence", () => {
  it("all three branches still match a full calculation after a tick sequence", () => {
    const seed = Array.from({ length: 50 }, (_, i) => candle(i, 100 + (i % 9)));
    let data = seed;
    const node = macd({ read: () => data }, { fast: 3, slow: 6, signal: 3 });

    const ticks: Array<{ kind: "replace" | "append"; close: number }> = [
      { kind: "replace", close: 150 },
      { kind: "append", close: 110 },
      { kind: "replace", close: 111 },
      { kind: "append", close: 95 },
      { kind: "replace", close: 96 },
    ];
    for (const tick of ticks) {
      const x = data[data.length - 1].x + (tick.kind === "append" ? 1 : 0);
      const point = candle(x, tick.close);
      data =
        tick.kind === "replace"
          ? [...data.slice(0, -1), point]
          : [...data, point];
      node.out.signal.read();
    }

    const fresh = macd({ read: () => data }, { fast: 3, slow: 6, signal: 3 });
    expect(node.out.macd.read()).toEqual(fresh.out.macd.read());
    expect(node.out.signal.read()).toEqual(fresh.out.signal.read());
    expect(node.out.histogram.read()).toEqual(fresh.out.histogram.read());
  });
});

// both sma and ema — windowed and recursive kernels checkpoint
// differently (window vs. ignition state).
describe("movingAverage — tail-door equivalence", () => {
  const seed = Array.from({ length: 40 }, (_, i) => candle(i, 100 + (i % 7)));

  function drive(type: "sma" | "ema") {
    let data = seed;
    const live = { read: () => data };
    const node = movingAverage(live, { period: 5, type });

    const ticks: Array<{ kind: "replace" | "append"; close: number }> = [
      { kind: "replace", close: 150 },
      { kind: "replace", close: 90 },
      { kind: "append", close: 110 },
      { kind: "replace", close: 111 },
      { kind: "append", close: 95 },
      { kind: "append", close: 96 },
    ];
    for (const tick of ticks) {
      const x = data[data.length - 1].x + (tick.kind === "append" ? 1 : 0);
      const point = candle(x, tick.close);
      data =
        tick.kind === "replace"
          ? [...data.slice(0, -1), point]
          : [...data, point];
      node.out.ma.read(); // read on every tick — the same rhythm as real usage (render)
    }

    const viaDoor = node.out.ma.read();
    const fresh = movingAverage({ read: () => data }, { period: 5, type })
      .out.ma.read();
    return { viaDoor, fresh };
  }

  it("sma — the answer through the door matches a full calculation", () => {
    const { viaDoor, fresh } = drive("sma");
    expect(viaDoor).toEqual(fresh);
  });

  it("ema — the recursive state's checkpoint matches too", () => {
    const { viaDoor, fresh } = drive("ema");
    expect(viaDoor).toEqual(fresh);
  });

  it("the array the door builds preserves identity for the untouched prefix — material for downstream comparisons", () => {
    let data = seed;
    const node = movingAverage({ read: () => data }, { period: 5 });
    const before = node.out.ma.read();

    data = [...data, candle(40, 200)];
    const after = node.out.ma.read();

    // The point objects from before the append are unchanged — downstream
    // nodes rely on that same tail-identity check.
    expect(after[10]).toBe(before[10]);
    expect(after.length).toBe(before.length + 1);
  });
});
