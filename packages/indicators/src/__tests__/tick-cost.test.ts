import type { BaseDataPoint, OHLC, Source } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  adx,
  atr,
  bollingerBands,
  cci,
  donchianChannels,
  ichimoku,
  keltnerChannels,
  obv,
  parabolicSar,
  pivotPoints,
  rsi,
  stochastic,
  superTrend,
  vwap,
  williamsR,
} from "../factories";

/**
 * A tick costs what it can reach, not the history: the fifteen that used to
 * recompute everything on every `updateLast` now either fold one bar from a
 * checkpoint or re-run only the window a tick can move. Two guards: a
 * work count (candle fields read and anchor calls made per tick, against a
 * 10 000-bar history), and a differential fuzz — ticks, pages and gaps
 * interleaved — that holds every branch to a cold node's output exactly.
 */

type Counter = { reads: number };

/** A candle whose price fields count their reads — the work a tick does, without a clock. */
function counted(counter: Counter, x: number, open: number, high: number, low: number, close: number, volume?: number | null): OHLC {
  const candle: OHLC = {
    x,
    open,
    get high() {
      counter.reads++;
      return high;
    },
    get low() {
      counter.reads++;
      return low;
    },
    get close() {
      counter.reads++;
      return close;
    },
  };
  if (volume !== undefined) Object.defineProperty(candle, "volume", { value: volume, enumerable: true });
  return candle;
}

function sourceOf(initial: OHLC[]) {
  let data = initial;
  const source: Source<OHLC> = { read: () => data };
  return {
    source,
    read: () => data,
    set: (next: OHLC[]) => void (data = next),
  };
}

type Build = (source: Source<OHLC>, anchorCalls: Counter) => Record<string, Source<BaseDataPoint>>;

const every = (count: Counter) => (_: OHLC, index: number) => {
  count.reads++;
  return index % 24 === 0;
};

const cases: [string, Build][] = [
  ["bollingerBands", (s) => bollingerBands(s).out],
  ["rsi", (s) => rsi(s).out],
  ["atr", (s) => atr(s).out],
  ["adx", (s) => adx(s).out],
  ["parabolicSar", (s) => parabolicSar(s).out],
  ["ichimoku", (s) => ichimoku(s).out],
  ["ichimoku ahead", (s) => ichimoku(s, { ahead: (x, k) => x + k * 60 }).out],
  ["vwap", (s, a) => vwap(s, { anchor: every(a) }).out],
  ["obv", (s) => obv(s).out],
  ["stochastic", (s) => stochastic(s).out],
  ["cci", (s) => cci(s).out],
  ["williamsR", (s) => williamsR(s).out],
  ["donchianChannels", (s) => donchianChannels(s).out],
  ["keltnerChannels", (s) => keltnerChannels(s).out],
  ["superTrend", (s) => superTrend(s).out],
  ["pivotPoints", (s, a) => pivotPoints(s, { anchor: every(a) }).out],
];

function readAll(out: Record<string, Source<BaseDataPoint>>) {
  const all: Record<string, readonly BaseDataPoint[]> = {};
  for (const key of Object.keys(out)) all[key] = out[key].read();
  return all;
}

describe.each(cases)("%s — a tick reads a bounded window", (_, build) => {
  it("an updateLast and a new bar each read a few hundred fields at most, of a 10 000-bar history", () => {
    const n = 10_000;
    const reads: Counter = { reads: 0 };
    const anchors: Counter = { reads: 0 };
    const bar = (i: number, bump = 0) => {
      const c = 100 + Math.sin(i / 7) * 5 + (i % 5) + bump;
      return counted(reads, i * 60, c - 0.5, c + 2, c - 2, c, 1000 + (i % 3) * 10);
    };
    const feed = sourceOf(Array.from({ length: n }, (_, i) => bar(i)));
    const out = build(feed.source, anchors);
    readAll(out);

    reads.reads = 0;
    anchors.reads = 0;
    feed.set([...feed.read().slice(0, -1), bar(n - 1, 0.75)]);
    readAll(out);
    expect(reads.reads, "fields read by an updateLast").toBeLessThan(1000);
    expect(anchors.reads, "anchor calls on an updateLast").toBeLessThan(10);

    reads.reads = 0;
    anchors.reads = 0;
    feed.set([...feed.read(), bar(n)]);
    readAll(out);
    expect(reads.reads, "fields read by a new bar").toBeLessThan(1000);
    expect(anchors.reads, "anchor calls on a new bar").toBeLessThan(10);
  });
});

/** mulberry32 — a seeded stream, so a failure replays. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smallCases: [string, Build][] = [
  ["bollingerBands", (s) => bollingerBands(s, { period: 5 }).out],
  ["rsi", (s) => rsi(s, { period: 4 }).out],
  ["atr", (s) => atr(s, { period: 4 }).out],
  ["adx", (s) => adx(s, { period: 3 }).out],
  ["parabolicSar", (s) => parabolicSar(s).out],
  ["ichimoku", (s) => ichimoku(s, { conversion: 3, base: 5, span: 8, displacement: 4 }).out],
  ["ichimoku ahead", (s) => ichimoku(s, { conversion: 3, base: 5, span: 8, displacement: 4, ahead: (x, k) => x + k * 60 }).out],
  ["vwap", (s) => vwap(s, { anchor: (c) => c.x % 900 === 0 }).out],
  ["obv", (s) => obv(s).out],
  ["stochastic", (s) => stochastic(s, { period: 4, smooth: 2, signal: 3 }).out],
  ["cci", (s) => cci(s, { period: 4 }).out],
  ["williamsR", (s) => williamsR(s, { period: 4 }).out],
  ["donchianChannels", (s) => donchianChannels(s, { period: 4 }).out],
  ["keltnerChannels", (s) => keltnerChannels(s, { period: 4, atrPeriod: 3 }).out],
  ["superTrend", (s) => superTrend(s, { period: 3, multiplier: 1 }).out],
  ["pivotPoints", (s) => pivotPoints(s, { anchor: (c, _, previous) => previous === null || c.x % 600 === 0 }).out],
];

describe.each(smallCases)("%s — ticks equal a cold node", (_, build) => {
  it.each([1, 2, 3, 4, 5, 6])("seed %i: replaces, appends, pages and volume gaps, branch by branch", (seed) => {
    const next = random(seed);
    const none: Counter = { reads: 0 };
    let first = 0;
    let last = -1;
    const make = (i: number): OHLC => {
      const c = 100 + Math.round(next() * 8) * 0.5;
      const high = c + Math.round(next() * 3);
      const low = c - Math.round(next() * 3);
      const volume = next() < 0.06 ? null : Math.round(next() * 1000);
      return { x: i * 60, open: c, high, low, close: c, volume };
    };
    const initial: OHLC[] = [];
    for (let i = 0; i < 12; i++) initial.push(make(++last));
    const feed = sourceOf(initial);
    const live = build(feed.source, none);
    readAll(live);

    for (let step = 0; step < 60; step++) {
      const roll = next();
      const data = feed.read();
      if (roll < 0.45) feed.set([...data.slice(0, -1), make(last)]);
      else if (roll < 0.85) {
        const grown = [...data];
        const count = 1 + Math.floor(next() * 3);
        for (let k = 0; k < count; k++) grown.push(make(++last));
        feed.set(grown);
      } else {
        const older: OHLC[] = [];
        const count = 1 + Math.floor(next() * 5);
        for (let k = 0; k < count; k++) older.unshift(make(--first));
        feed.set([...older, ...data]);
      }
      const snapshot = feed.read();
      const cold = readAll(build({ read: () => snapshot }, none));
      expect(readAll(live), `step ${step}`).toEqual(cold);
    }
  });
});

describe("a tick that throws midway leaves the checkpoint as it was", () => {
  it("vwap: an anchor that throws once on a tick, then answers — the retry equals a cold node", () => {
    // The last bar opens a session (index 32), so an anchor asked with a drifted index would not reset.
    const bars = Array.from({ length: 33 }, (_, i) => ({ x: i, open: 10, high: 11 + (i % 3), low: 9, close: 10 + (i % 4), volume: 100 + i }));
    let fail = false;
    const anchor = (_: OHLC, index: number) => {
      if (fail) {
        fail = false;
        throw new Error("once");
      }
      return index % 8 === 0;
    };
    const feed = sourceOf(bars);
    const live = vwap(feed.source, { anchor });
    live.out.vwap.read();
    for (const close of [12, 13]) {
      feed.set([...feed.read().slice(0, -1), { ...bars[32], close }]);
      fail = true;
      expect(() => live.out.vwap.read()).toThrow("once");
      const snapshot = feed.read();
      expect(live.out.vwap.read()).toEqual(vwap({ read: () => snapshot }, { anchor }).out.vwap.read());
    }
  });
});
