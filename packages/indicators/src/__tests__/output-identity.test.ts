import type { BaseDataPoint, OHLC, Source } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  adx,
  atr,
  awesomeOscillator,
  bbi,
  brar,
  cr,
  kdj,
  elderRay,
  macd,
  mfi,
  momentum,
  movingAverage,
  bollingerBands,
  cci,
  dma,
  donchianChannels,
  emv,
  ichimoku,
  keltnerChannels,
  obv,
  parabolicSar,
  pivotPoints,
  psy,
  pvt,
  roc,
  rsi,
  squeezeMomentum,
  stochastic,
  stochasticRsi,
  superTrend,
  trix,
  ultimateOscillator,
  vr,
  vwap,
  williamsR,
} from "../factories";

/**
 * Every indicator's tick must read downstream as a tail change — so a tick
 * keeps every earlier output object on every branch (a displaced line like
 * Ichimoku's chikou legitimately fills one more slot). The windowed ones
 * re-run the window a tick reaches and reuse what did not change; the
 * fold-node increments rebuild only the tail. Without this, every tick would
 * read downstream as a full change: re-validate, copy, re-map the whole
 * history per drawn branch.
 */

function candle(x: number): OHLC {
  const close = 100 + Math.sin(x / 3) * 10 + (x % 7);
  return { x, open: close - 1, high: close + 3, low: close - 3, close, volume: 1000 + (x % 5) * 100 };
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

type Build = (source: Source<OHLC>) => Source<BaseDataPoint>[];

const cases: [string, Build][] = [
  ["movingAverage", (s) => Object.values(movingAverage(s, { period: 5 }).out)],
  ["macd", (s) => Object.values(macd(s).out)],
  ["atr", (s) => Object.values(atr(s).out)],
  ["adx", (s) => Object.values(adx(s).out)],
  ["bollingerBands", (s) => Object.values(bollingerBands(s).out)],
  ["rsi", (s) => Object.values(rsi(s).out)],
  ["stochastic", (s) => Object.values(stochastic(s).out)],
  ["cci", (s) => Object.values(cci(s).out)],
  ["williamsR", (s) => Object.values(williamsR(s).out)],
  ["donchianChannels", (s) => Object.values(donchianChannels(s).out)],
  ["keltnerChannels", (s) => Object.values(keltnerChannels(s).out)],
  ["superTrend", (s) => Object.values(superTrend(s).out)],
  ["ichimoku", (s) => Object.values(ichimoku(s).out)],
  ["parabolicSar", (s) => Object.values(parabolicSar(s).out)],
  ["obv", (s) => Object.values(obv(s).out)],
  ["vwap", (s) => Object.values(vwap(s).out)],
  ["pivotPoints", (s) => Object.values(pivotPoints(s, { anchor: (_, index) => index % 10 === 0 }).out)],
  ["stochasticRsi", (s) => Object.values(stochasticRsi(s, { rsiPeriod: 5, period: 5 }).out)],
  ["mfi", (s) => Object.values(mfi(s, { period: 5 }).out)],
  ["ultimateOscillator", (s) => Object.values(ultimateOscillator(s, { fast: 3, middle: 5, slow: 7 }).out)],
  ["awesomeOscillator", (s) => Object.values(awesomeOscillator(s, { fast: 3, slow: 8 }).out)],
  ["momentum", (s) => Object.values(momentum(s, { period: 4, signal: 3 }).out)],
  ["elderRay", (s) => Object.values(elderRay(s, { period: 5 }).out)],
  ["squeezeMomentum", (s) => Object.values(squeezeMomentum(s, { bbPeriod: 6, kcPeriod: 5 }).out)],
  ["roc", (s) => Object.values(roc(s, { period: 4, signal: 3 }).out)],
  ["trix", (s) => Object.values(trix(s, { period: 4, signal: 3 }).out)],
  ["psy", (s) => Object.values(psy(s, { period: 5, signal: 3 }).out)],
  ["bbi", (s) => Object.values(bbi(s, { periods: [2, 3, 4, 5] }).out)],
  ["dma", (s) => Object.values(dma(s, { fast: 3, slow: 6, signal: 3 }).out)],
  ["brar", (s) => Object.values(brar(s, { period: 5 }).out)],
  ["cr", (s) => Object.values(cr(s, { period: 3, periods: [2, 3, 4, 5] }).out)],
  ["kdj", (s) => Object.values(kdj(s, { period: 3, smooth: 2, signal: 2 }).out)],
  ["vr", (s) => Object.values(vr(s, { period: 5, signal: 3 }).out)],
  ["emv", (s) => Object.values(emv(s, { period: 4 }).out)],
  ["pvt", (s) => Object.values(pvt(s).out)],
];

function newObjectsInPrefix(before: readonly BaseDataPoint[], after: readonly BaseDataPoint[]): number {
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (after[i] !== before[i]) changed += 1;
  return changed;
}

describe.each(cases)("%s", (name, build) => {
  it("a new bar keeps the earlier output objects on every branch", () => {
    const data = Array.from({ length: 80 }, (_, i) => candle(i));
    const source = sourceOf(data);
    const branches = build(source);
    const before = branches.map((branch) => [...branch.read()]);

    source.swap([...data, candle(80)]);

    branches.forEach((branch, k) => {
      const after = branch.read();
      if (name === "bollingerBands") {
        expect(after).toHaveLength(81);
        expect(newObjectsInPrefix(before[k], after), `branch ${k}`).toBe(0);
      } else {
        expect(after.length, `branch ${k} grows`).toBeGreaterThan(before[k].length - 1);
        expect(newObjectsInPrefix(before[k], after), `branch ${k}`).toBeLessThanOrEqual(1);
      }
    });
  });

  it("a replaced last bar keeps the earlier output objects on every branch", () => {
    const data = Array.from({ length: 80 }, (_, i) => candle(i));
    const source = sourceOf(data);
    const branches = build(source);
    const before = branches.map((branch) => [...branch.read()]);

    const last = { ...data[79], close: data[79].close + 5, high: data[79].high + 5 };
    source.swap([...data.slice(0, 79), last]);

    branches.forEach((branch, k) => {
      const after = branch.read();
      const prefix = before[k].slice(0, before[k].length - 1);
      expect(newObjectsInPrefix(prefix, after), `branch ${k}`).toBeLessThanOrEqual(1);
    });
  });
});
