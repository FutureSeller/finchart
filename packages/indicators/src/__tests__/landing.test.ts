/**
 * A history page landing on the published indicators — the head door
 * (`calcFirst`) must carry it: no full recomputation, values that agree
 * with a cold full computation within the landing contract's bound.
 *
 * The bound (1e-9 relative) is the real contract, not a softened one: a
 * landing restarts the fold on a new prefix, and a running-sum or
 * recursive kernel's rounding path is history-dependent, so the last bits
 * legitimately drift with how history arrived. Every bug this file exists
 * to catch (a stale head, a shifted window, warmup nulls left behind)
 * moves values by five-plus orders of magnitude more.
 */
import { describe, expect, it } from "vitest";
import type { OHLC, Source } from "@finchart/core";
import {
  adx,
  atr,
  bollingerBands,
  cci,
  donchianChannels,
  keltnerChannels,
  macd,
  movingAverage,
  rsi,
  stochastic,
  williamsR,
} from "../factories";
import type { Computation } from "@finchart/core";
import { ema, sma } from "../kernels";

const bar = (i: number): OHLC => {
  const v = 100 + Math.sin(i / 17) * 9 + (i % 5) * 0.7;
  return { x: i * 60, open: v, high: v + 1, low: v - 1, close: v + 0.3 };
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
 * Every doored indicator, against a cold node given the full history at
 * once — the factory itself is the reference, so a wrong `headLookback`
 * declaration reds here without any hand-rolled formula (proven by
 * mutation: shrinking a horizon by one fails its row).
 */
describe("every doored indicator lands within the bound", () => {
  const doored: [string, (source: Source<OHLC>) => Computation<Record<string, { x: number }[]>>][] = [
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
  ];

  it.each(doored)("%s", (_name, make) => {
    const f = feed(bars(2000, 6000));
    const landed = make(f.source);
    const branches = Object.keys(landed.out);
    const before = new Map(branches.map((key) => [key, landed.out[key].read()]));

    for (const page of [bars(1500, 2000), bars(1499, 1500), bars(600, 1499)]) {
      f.prepend(page);
      for (const key of branches) landed.out[key].read();
    }

    const cold = make({ read: () => bars(600, 6000) });
    for (const key of branches) {
      const after = landed.out[key].read();
      const want = cold.out[key].read();
      expect(after.length, `${key} length`).toBe(want.length);
      // The tail beyond every landing's reach is the original objects —
      // the proof the full path never ran.
      const held = before.get(key);
      if (held !== undefined && held.length > 0) {
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

  it("ema rides the head door on its decay horizon — bounded drift, reused tail", () => {
    const f = feed(bars(500, 1600));
    const node = movingAverage(f.source, { period: 20, type: "ema" });
    const before = node.out.ma.read();

    f.prepend(bars(100, 500));
    const after = node.out.ma.read();

    expect(after[after.length - 1]).toBe(before[before.length - 1]);

    const all = bars(100, 1600);
    expectClose(after, ema(closes(all), 20), all.map((p) => p.x), "ema");
  });

  it("macd rides the head door across its three chained folds", () => {
    const f = feed(bars(500, 2600));
    const node = macd(f.source, {});
    const before = node.out.histogram.read();

    f.prepend(bars(300, 500));
    f.prepend(bars(299, 300));
    const histogram = node.out.histogram.read();

    expect(histogram[histogram.length - 1]).toBe(before[before.length - 1]);

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
