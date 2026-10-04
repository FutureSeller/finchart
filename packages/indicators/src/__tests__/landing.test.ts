/**
 * History pages agree with a cold full computation. Finite-window nodes
 * also retain the untouched tail; recursive nodes recompute the history
 * because seed magnitude and missing observations have no fixed horizon.
 */
import { describe, expect, it } from "vitest";
import type { OHLC, Source } from "@finchart/core";
import {
  adx,
  atr,
  awesomeOscillator,
  elderRay,
  bollingerBands,
  ichimoku,
  cci,
  donchianChannels,
  keltnerChannels,
  macd,
  mfi,
  momentum,
  movingAverage,
  rsi,
  bbi,
  brar,
  cr,
  kdj,
  dma,
  emv,
  pvt,
  vr,
  psy,
  roc,
  squeezeMomentum,
  stochastic,
  trix,
  stochasticRsi,
  ultimateOscillator,
  williamsR,
} from "../factories";
import type { Computation } from "@finchart/core";
import { ema, sma } from "../kernels";

const bar = (i: number): OHLC => {
  const v = 100 + Math.sin(i / 17) * 9 + (i % 5) * 0.7;
  // Volume varies so the volume-fed indicators (MFI, VR, EMV, PVT) produce values, not nulls.
  return { x: i * 60, open: v, high: v + 1, low: v - 1, close: v + 0.3, volume: 1000 + (i % 7) * 50 };
};
const bars = (from: number, to: number): OHLC[] => {
  const out: OHLC[] = [];
  for (let i = from; i < to; i++) out.push(bar(i));
  return out;
};

function feed(initial: OHLC[]) {
  let data = initial;
  let reads = 0;
  const source: Source<OHLC> = {
    read: () => {
      reads++;
      return data;
    },
  };
  return {
    source,
    prepend(older: OHLC[]) {
      data = [...older, ...data];
    },
    append(next: OHLC) {
      data = [...data, next];
    },
    replaceLast(next: OHLC) {
      data = [...data.slice(0, -1), next];
    },
    get reads() {
      return reads;
    },
  };
}

function expectClose(
  actual: readonly { x: number; y: number | null }[],
  expected: readonly (number | null)[],
  xs: readonly number[],
  label: string,
): void {
  expect(actual.length, label).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].x, `${label} x[${i}]`).toBe(xs[i]);
    const want = expected[i];
    if (want === null) {
      expect(actual[i].y, `${label} y[${i}]`).toBeNull();
    } else {
      expect(actual[i].y, `${label} y[${i}]`).not.toBeNull();
      const bound = Math.max(1e-9, Math.abs(want) * 1e-9);
      expect(Math.abs((actual[i].y ?? Number.NaN) - want), `${label} y[${i}]`).toBeLessThanOrEqual(bound);
    }
  }
}

const closes = (data: readonly OHLC[]) => data.map((point) => point.close);

/**
 * Compare every output field with a cold node. AO and Squeeze include the
 * prior histogram bar in their finite lookback so their tones agree too.
 */
describe("every indicator landing agrees with a cold computation", () => {
  const factories: [string, (source: Source<OHLC>) => Computation<Record<string, { x: number }[]>>][] = [
    ["movingAverage sma", (s) => movingAverage(s, { period: 14 })],
    ["movingAverage ema", (s) => movingAverage(s, { period: 14, type: "ema" })],
    ["macd", (s) => macd(s, {})],
    ["bollingerBands", (s) => bollingerBands(s, {})],
    ["rsi", (s) => rsi(s, {})],
    ["atr", (s) => atr(s, {})],
    ["adx", (s) => adx(s, {})],
    ["stochastic", (s) => stochastic(s, {})],
    ["cci", (s) => cci(s, {})],
    ["williamsR", (s) => williamsR(s, {})],
    ["donchianChannels", (s) => donchianChannels(s, {})],
    ["keltnerChannels", (s) => keltnerChannels(s, {})],
    ["stochasticRsi", (s) => stochasticRsi(s, {})],
    ["mfi", (s) => mfi(s, {})],
    ["ultimateOscillator", (s) => ultimateOscillator(s, {})],
    ["awesomeOscillator", (s) => awesomeOscillator(s, {})],
    ["momentum", (s) => momentum(s, {})],
    ["elderRay", (s) => elderRay(s, {})],
    ["squeezeMomentum", (s) => squeezeMomentum(s, {})],
    ["roc", (s) => roc(s, {})],
    ["trix", (s) => trix(s, {})],
    ["psy", (s) => psy(s, {})],
    ["bbi", (s) => bbi(s, {})],
    ["dma", (s) => dma(s, {})],
    ["brar", (s) => brar(s, {})],
    ["cr", (s) => cr(s, {})],
    ["vr", (s) => vr(s, {})],
    ["emv", (s) => emv(s, {})],
    ["ichimoku", (s) => ichimoku(s, {})],
    // pvt declares no door (a running sum has no bounded lookback) — it lands by recomputing, like obv;
    // so does kdj (its recursions' memory is counted in observations, and a flat stretch holds it).
  ];

  const recursive = new Set(["movingAverage ema", "macd", "rsi", "atr", "adx", "keltnerChannels", "stochasticRsi", "elderRay", "trix"]);

  it.each(factories)("%s", (name, make) => {
    // CI keeps every factory and every landing shape, with a shorter history.
    // The full history remains in the local gate.
    const [start, end, firstPage, oldest] = process.env.FINCHART_SKIP_STRESS === "1"
      ? [500, 900, 400, 300]
      : [2000, 6000, 1500, 600];
    const f = feed(bars(start, end));
    const landed = make(f.source);
    const branches = Object.keys(landed.out);
    const before = new Map(branches.map((key) => [key, landed.out[key].read()]));

    for (const page of [bars(firstPage, start), bars(firstPage - 1, firstPage), bars(oldest, firstPage - 1)]) {
      f.prepend(page);
      for (const key of branches) landed.out[key].read();
    }

    const cold = make({ read: () => bars(oldest, end) });
    for (const key of branches) {
      const after = landed.out[key].read();
      const want = cold.out[key].read();
      expect(after.length, `${key} length`).toBe(want.length);
      // Finite-window nodes preserve the original objects beyond the
      // corrected head. Recursive nodes deliberately take the full path.
      const held = before.get(key);
      if (!recursive.has(name) && held !== undefined && held.length > 0) {
        expect(after[after.length - 1], `${key} tail identity`).toBe(
          held[held.length - 1],
        );
      }
      for (let i = 0; i < want.length; i++) {
        expect(after[i].x, `${key} x[${i}]`).toBe(want[i].x);
        // Branch shapes vary (y, upper/lower bands) — compare every field.
        const wantPoint: Record<string, unknown> = want[i];
        const afterPoint: Record<string, unknown> = after[i];
        for (const field of Object.keys(wantPoint)) {
          const w = wantPoint[field];
          const a = afterPoint[field];
          if (typeof w === "number" && typeof a === "number") {
            const bound = Math.max(1e-9, Math.abs(w) * 1e-9);
            expect(Math.abs(a - w), `${key} ${field}[${i}]`).toBeLessThanOrEqual(bound);
          } else {
            expect(a, `${key} ${field}[${i}]`).toEqual(w);
          }
        }
      }
    }
  });
});

describe("indicator landings", () => {
  it("sma rides the head door — pages land without a full recomputation", () => {
    const f = feed(bars(100, 400));
    const node = movingAverage(f.source, { period: 20 });
    node.out.ma.read();

    let fulls = 0;
    // A full computation reads nothing extra — count via a wrapped kernel
    // instead: track by timing the only observable, the reused tail.
    const before = node.out.ma.read();
    for (const page of [bars(60, 100), bars(59, 60), bars(20, 59)]) {
      f.prepend(page);
      node.out.ma.read();
    }
    void fulls;
    const after = node.out.ma.read();

    // The untouched tail keeps identity — the proof no full path ran.
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
    expect(after[after.length - 150]).toBe(before[before.length - 150]);

    const all = bars(20, 400);
    expectClose(after, sma(closes(all), 20), all.map((p) => p.x), "sma");
  });

  it("ema recomputes the full history on a landing", () => {
    const f = feed(bars(500, 1600));
    const node = movingAverage(f.source, { period: 20, type: "ema" });
    const before = node.out.ma.read();

    f.prepend(bars(100, 500));
    const after = node.out.ma.read();

    expect(after[after.length - 1]).not.toBe(before[before.length - 1]);

    const all = bars(100, 1600);
    expectClose(after, ema(closes(all), 20), all.map((p) => p.x), "ema");
  });

  it("macd recomputes all three chained folds on a landing", () => {
    const f = feed(bars(500, 2600));
    const node = macd(f.source, {});
    const before = node.out.histogram.read();

    f.prepend(bars(300, 500));
    f.prepend(bars(299, 300));
    const histogram = node.out.histogram.read();

    expect(histogram[histogram.length - 1]).not.toBe(before[before.length - 1]);

    // The cold-computation reference: macd over everything, from scratch.
    const all = bars(299, 2600);
    const fast = ema(closes(all), 12);
    const slow = ema(closes(all), 26);
    const line = fast.map((v, i) => {
      const s = slow[i];
      return v === null || s === null ? null : v - s;
    });
    const signal = ema(line, 9);
    const wantHistogram = line.map((v, i) => {
      const s = signal[i];
      return v === null || s === null ? null : v - s;
    });
    expectClose(histogram, wantHistogram, all.map((p) => p.x), "histogram");
  });
});

/**
 * A landing re-runs `calc` on a prefix, and the increments (MA, MACD) keep
 * their resume checkpoints in `calc`. The tick right after a landing must
 * therefore not resume from that checkpoint — it belongs to the prefix,
 * not the array. Deep history on purpose: MACD's lookback is ~480 bars, so
 * a short fixture makes the prefix the whole array and hides the bug.
 */
describe("a landing, then ticks — the increments still agree with a cold node", () => {
  const increments: [string, (source: Source<OHLC>) => Computation<Record<string, { x: number; y: number | null }[]>>][] = [
    ["movingAverage sma", (s) => movingAverage(s, { period: 5 })],
    ["movingAverage ema", (s) => movingAverage(s, { period: 5, type: "ema" })],
    ["macd", (s) => macd(s, {})],
    ["stochasticRsi", (s) => stochasticRsi(s, {})],
    ["mfi", (s) => mfi(s, {})],
    ["ultimateOscillator", (s) => ultimateOscillator(s, {})],
    ["awesomeOscillator", (s) => awesomeOscillator(s, {})],
    ["momentum", (s) => momentum(s, {})],
    ["elderRay", (s) => elderRay(s, {})],
    ["squeezeMomentum", (s) => squeezeMomentum(s, {})],
    ["roc", (s) => roc(s, {})],
    ["trix", (s) => trix(s, {})],
    ["psy", (s) => psy(s, {})],
    ["bbi", (s) => bbi(s, {})],
    ["dma", (s) => dma(s, {})],
    ["brar", (s) => brar(s, {})],
    ["cr", (s) => cr(s, {})],
    ["vr", (s) => vr(s, {})],
    ["emv", (s) => emv(s, {})],
    ["pvt", (s) => pvt(s)],
    ["kdj", (s) => kdj(s, {})],
  ];

  it.each(increments)("%s", (_name, make) => {
    const f = feed(bars(2000, 6000));
    const node = make(f.source);
    const branches = Object.keys(node.out);
    for (const key of branches) node.out[key].read();

    f.prepend(bars(1000, 2000));
    for (const key of branches) node.out[key].read();

    const last = bar(5999);
    const ticks = [
      () => f.replaceLast({ ...last, close: last.close + 1 }),
      () => f.append(bar(6000)),
      () => f.append(bar(6001)),
    ];
    for (const tick of ticks) {
      tick();
      for (const key of branches) node.out[key].read();
    }

    const cold = make({ read: () => f.source.read() });
    for (const key of branches) {
      const got = node.out[key].read();
      const want = cold.out[key].read();
      expect(got.length, `${key} length`).toBe(want.length);
      for (let i = want.length - 5; i < want.length; i++) {
        expect(got[i].y, `${key} y[${i}]`).toBe(want[i].y);
      }
    }
  });
});

describe("history corrections across gaps and composed indicators", () => {
  const bar = (x: number, close: number, volume = 100): OHLC => ({
    x, open: close, high: close, low: close, close, volume,
  });

  it.each(['ema', 'macd', 'rsi'] as const)('%s lands nullable observations after a long gap exactly', kind => {
    let data: {
      x: number;
      y: number | null;
    }[] = [
      { x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 10 }, { x: 3, y: 20 },
      ...Array.from({ length: 200 }, (_, i) => ({ x: 4 + i, y: null })),
      { x: 204, y: 30 }, { x: 205, y: 20 },
    ];
    const make = (source: { read: () => typeof data }) =>
      kind === 'ema'
        ? movingAverage(source, { period: 3, type: 'ema', value: p => p.y })
        : kind === 'macd'
          ? macd(source, { fast: 2, slow: 3, signal: 2, value: p => p.y })
          : rsi(source, { period: 2, value: p => p.y });
    const node = make({ read: () => data });
    for (const out of Object.values(node.out)) {
      out.read();
    }
    data = [{ x: -4, y: 200 }, { x: -3, y: 100 }, { x: -2, y: 200 }, { x: -1, y: 100 }, ...data];
    const cold = make({ read: () => data });
    expect(Object.values(node.out).map(out => out.read())).toEqual(Object.values(cold.out).map(out => out.read()));
  });

  it('propagates upstream SMA corrections through a second SMA', () => {
    let data = Array.from({ length: 10 }, (_, i) => bar(i + 1, (i + 1) * 10));
    const inner = movingAverage({ read: () => data }, { period: 3 });
    const outer = movingAverage(inner.out.ma, { period: 3, value: p => p.y });
    outer.out.ma.read();
    data = [bar(0, 0), ...data];
    const cold = movingAverage(movingAverage({ read: () => data }, { period: 3 }).out.ma, { period: 3, value: p => p.y });
    expect(outer.out.ma.read()).toEqual(cold.out.ma.read());
    expect(outer.out.ma.read().find(p => p.x === 4)?.y).toBe(20);
  });

  it('recomputes both MACD recurrences even when fast exceeds slow', () => {
    let data = Array.from({ length: 1000 }, (_, i) => bar(i + 100, 10 + Math.sin(i)));
    const options = { fast: 100, slow: 3, signal: 2 };
    const node = macd({ read: () => data }, options);
    node.out.macd.read();
    data = [...Array.from({ length: 100 }, (_, i) => bar(i, 100)), ...data];
    const expected = macd({ read: () => data }, options).out.macd.read();
    node.out.macd.read().forEach((point, i) => {
      const want = expected[i].y;
      if (want === null) {
        expect(point.y).toBeNull();
      } else {
        expect(point.y).toBeCloseTo(want, 8);
      }
    });
  });

  it('does not retain a recursive tail after an arbitrarily large earlier seed', () => {
    let data = Array.from({ length: 100 }, (_, i) => bar(i, 10));
    const node = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    node.out.ma.read();
    data = [bar(-3, 1e100), bar(-2, 1e100), bar(-1, 1e100), ...data];
    const cold = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    expect(node.out.ma.read()).toEqual(cold.out.ma.read());
    expect(node.out.ma.read().at(-1)?.y).toBeGreaterThan(1e60);
  });

  it('recomputes a default EMA whose observations pause at the numeric boundary', () => {
    let data = [bar(0, 10), bar(1, 10), bar(2, 10),
      ...Array.from({ length: 100 }, (_, i) => bar(i + 3, Number.MAX_VALUE)), bar(103, 20)];
    const node = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    node.out.ma.read();
    data = [bar(-3, 100), bar(-2, 100), bar(-1, 100), ...data];
    const cold = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    expect(node.out.ma.read()).toEqual(cold.out.ma.read());
    expect(node.out.ma.read().at(-1)?.y).toBe(20.625);
  });
});
