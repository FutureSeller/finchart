/**
 * Stochastic RSI, MFI, Ultimate Oscillator — wave 1. Exact values pinned
 * with short scripts checked by hand, the conventions at their edges
 * (first bar, zero denominators, a bar without volume), and Stochastic RSI's
 * composition checked against the package's own rsi and array kernels — the
 * same folds the node runs, so not an independent check of their values.
 */
import type { HistogramPoint, LineDataPoint, OHLC, Source } from "@finchart/core";
import { ContractError, M4Decimation } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { awesomeOscillator, elderRay, mfi, momentum, rsi, squeezeMomentum, stochasticRsi, ultimateOscillator } from "../factories";
import { highest, lowest, sma, stddev } from "../kernels";
import { toneOf } from "../tone";

function bar(x: number, high: number, low: number, close: number, volume?: number | null): OHLC {
  const candle: OHLC = { x, open: close, high, low, close };
  if (volume !== undefined) candle.volume = volume;
  return candle;
}

function sourceOf(candles: OHLC[]): Source<OHLC> {
  return { read: () => candles };
}

const ys = (points: readonly { y: number | null }[]) => points.map((p) => p.y);

describe("mfi", () => {
  // typical prices 2 → 3 (up, flow 30) → 2 (down, flow 10) → 2 (flat, no flow)
  const tape = [bar(0, 3, 1, 2, 10), bar(1, 4, 2, 3, 10), bar(2, 3, 1, 2, 5), bar(3, 3, 1, 2, 7)];

  it("is RSI's shape over money flow, by hand", () => {
    const out = ys(mfi(sourceOf(tape), { period: 2 }).out.mfi.read());
    // [2]: window {up 30, down 10} → 100 − 100/(1 + 3) = 75; [3]: {down 10, nothing} → 0
    expect(out).toEqual([null, null, 75, 0]);
  });

  it("is 100 when nothing flowed down, null when nothing flowed at all", () => {
    const up = [bar(0, 3, 1, 2, 10), bar(1, 4, 2, 3, 10), bar(2, 5, 3, 4, 10)];
    expect(ys(mfi(sourceOf(up), { period: 2 }).out.mfi.read())).toEqual([null, null, 100]);
    const flat = [bar(0, 3, 1, 2, 10), bar(1, 3, 1, 2, 10), bar(2, 3, 1, 2, 10)];
    expect(ys(mfi(sourceOf(flat), { period: 2 }).out.mfi.read())).toEqual([null, null, null]);
  });

  it("flows on the typical price, not the close — an asymmetric candle tells them apart", () => {
    // TP: (9+3+3)/3 = 5 → (6+3+6)/3 = 5 (unchanged: neither) → (12+3+3)/3 = 6 (up, flow 6×2) → (5+1+3)/3 = 3 (down, flow 3×4)
    // Closes: 3 → 6 → 3 → 3 would read up, down, flat instead.
    const tape = [bar(0, 9, 3, 3, 1), bar(1, 6, 3, 6, 1), bar(2, 12, 3, 3, 2), bar(3, 5, 1, 3, 4)];
    const out = ys(mfi(sourceOf(tape), { period: 2 }).out.mfi.read());
    // [2]: {neither, up 12} → 100; [3]: {up 12, down 12} → 50
    expect(out).toEqual([null, null, 100, 50]);
  });

  it("a bar without volume nulls every window that holds it, and the value comes back", () => {
    const gapped = [bar(0, 3, 1, 2, 10), bar(1, 4, 2, 3, 10), bar(2, 3, 1, 2), bar(3, 4, 2, 3, 4), bar(4, 3, 1, 2, 6)];
    const out = ys(mfi(sourceOf(gapped), { period: 2 }).out.mfi.read());
    // [4]: window {up 12 (2→3, flow 3×4), down 12 (3→2, flow 2×6)} → 50
    expect(out).toEqual([null, null, null, null, 50]);
  });
});

describe("ultimateOscillator", () => {
  // closes 10 → 11 → 12 → 10 with previous-close-aware BP/TR:
  // [1] BP 1 TR 2 · [2] BP 1 TR 2 · [3] BP 0 TR 2
  const tape = [bar(0, 11, 9, 10), bar(1, 12, 10, 11), bar(2, 13, 11, 12), bar(3, 12, 10, 10)];

  it("weights three windows 4/2/1, by hand — and the first bar is null", () => {
    const out = ys(ultimateOscillator(sourceOf(tape), { fast: 1, middle: 2, slow: 3 }).out.uo.read());
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    // a1 = 0/2, a2 = 1/4, a3 = 2/6 → 100 × (0 + 0.5 + 1/3) / 7
    expect(out[3]).toBeCloseTo((100 * (0.5 + 1 / 3)) / 7, 12);
  });

  it("true range reaches back to the previous close — a gap tells it from high − low", () => {
    // close 10 → gap up: high 20 low 18 close 19: BP = 19 − min(18, 10) = 9, TR = max(20, 10) − 10 = 10 (high−low would be 2)
    const tape = [bar(0, 11, 9, 10), bar(1, 20, 18, 19)];
    const out = ys(ultimateOscillator(sourceOf(tape), { fast: 1, middle: 1, slow: 1 }).out.uo.read());
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(90, 12); // 100 × 7 × 0.9 / 7 — a high−low range would give 450

  });

  it("the weights follow the sorted windows, whatever order the options came in", () => {
    const sorted = ys(ultimateOscillator(sourceOf(tape), { fast: 1, middle: 2, slow: 3 }).out.uo.read());
    const shuffled = ys(ultimateOscillator(sourceOf(tape), { fast: 3, middle: 1, slow: 2 }).out.uo.read());
    expect(shuffled).toEqual(sorted);
  });

  it("is null while a window's true range sums to 0", () => {
    const still = [bar(0, 10, 10, 10), bar(1, 10, 10, 10), bar(2, 10, 10, 10)];
    expect(ys(ultimateOscillator(sourceOf(still), { fast: 1, middle: 1, slow: 2 }).out.uo.read())).toEqual([null, null, null]);
  });
});

describe("stochasticRsi", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 4) * 8 + (i % 3));
  const tape = closes.map((c, i) => bar(i, c + 1, c - 1, c));

  it("is the stochastic of the rsi — the composition against the package's own rsi, extremum and sma kernels", () => {
    const options = { rsiPeriod: 7, period: 5, smooth: 3, signal: 2 };
    const node = stochasticRsi(sourceOf(tape), options);
    const r = ys(rsi(sourceOf(tape), { period: options.rsiPeriod }).out.rsi.read());
    const top = highest(r, options.period);
    const bottom = lowest(r, options.period);
    const raw = r.map((v, i) => {
      const t = top[i];
      const b = bottom[i];
      return v === null || t === null || b === null || t === b ? null : (100 * (v - b)) / (t - b);
    });
    const k = sma(raw, options.smooth);
    const d = sma(k, options.signal);
    expect(ys(node.out.k.read())).toEqual(k);
    expect(ys(node.out.d.read())).toEqual(d);
  });

  it("a flat rsi window is null — neither 0 nor 100", () => {
    const rising = Array.from({ length: 30 }, (_, i) => bar(i, 101 + i, 99 + i, 100 + i));
    const out = ys(stochasticRsi(sourceOf(rising), { rsiPeriod: 3, period: 3, smooth: 1, signal: 1 }).out.k.read());
    // rsi is pinned at 100 once seeded → highest = lowest → null throughout
    expect(out.every((v) => v === null)).toBe(true);
  });
});

describe("awesomeOscillator", () => {
  it("is the short sma of the median price minus the long one, by hand", () => {
    // medians 2, 4, 6 → fast 1 / slow 2: [1] 4 − 3 = 1, [2] 6 − 5 = 1
    const tape = [bar(0, 3, 1, 2), bar(1, 5, 3, 4), bar(2, 7, 5, 6)];
    expect(ys(awesomeOscillator(sourceOf(tape), { fast: 1, slow: 2 }).out.ao.read())).toEqual([null, 1, 1]);
  });

  it("equal windows are always 0; swapped windows flip the sign — not sorted", () => {
    const tape = [2, 3, 5, 9, 17].map((m, i) => bar(i, m + 1, m - 1, m));
    expect(ys(awesomeOscillator(sourceOf(tape), { fast: 2, slow: 2 }).out.ao.read())).toEqual([null, 0, 0, 0, 0]);
    const forward = ys(awesomeOscillator(sourceOf(tape), { fast: 2, slow: 3 }).out.ao.read());
    const backward = ys(awesomeOscillator(sourceOf(tape), { fast: 3, slow: 2 }).out.ao.read());
    expect(backward).toEqual(forward.map((v) => (v === null ? null : -v)));
  });

  it("uses the median price, not the close — an off-centre candle tells them apart", () => {
    // medians 2, 2 (closes 1, 3): ao = 0 either way only if the median is used
    const tape = [bar(0, 3, 1, 1), bar(1, 3, 1, 3)];
    expect(ys(awesomeOscillator(sourceOf(tape), { fast: 1, slow: 2 }).out.ao.read())).toEqual([null, 0]);
  });

  it("each bar carries its direction against the bar before as tone, live ticks included", () => {
    const tape = Array.from({ length: 60 }, (_, i) => bar(i, 102 + Math.sin(i / 4) * 5, 98 + Math.sin(i / 4) * 5, 100));
    expectTonedLikeCold(tape, (s) => awesomeOscillator(s, { fast: 3, slow: 7 }).out.ao);
  });
});

/**
 * Tone against an array oracle, then through an append and a replace —
 * the live bar's tone must come from the kept prefix, not from a stale
 * checkpoint.
 */
function expectTonedLikeCold(tape: OHLC[], make: (s: Source<OHLC>) => Source<HistogramPoint>) {
  const check = (points: readonly HistogramPoint[]) => {
    expect(points.some((p) => p.tone === "up") && points.some((p) => p.tone === "down"), "both tones occur").toBe(true);
    for (let i = 0; i < points.length; i++) {
      expect(points[i].tone, `tone[${i}]`).toBe(toneOf(i > 0 ? points[i - 1].y : undefined, points[i].y));
    }
  };
  let data = tape;
  const live = make({ read: () => data });
  check(live.read());
  const last = tape[tape.length - 1];
  for (const next of [
    { ...last, x: last.x + 1, close: last.close + 40, high: last.high + 40, low: last.low + 40 },
    { ...last, x: last.x + 1, close: last.close - 40, high: last.high - 40, low: last.low - 40 },
  ]) {
    data = [...data.slice(0, tape.length), next];
    const points = live.read();
    check(points);
    const cold = make({ read: () => data }).read();
    expect(points[points.length - 1].tone, "the live bar").toBe(cold[cold.length - 1].tone);
  }
}

describe("momentum", () => {
  it("lands a page shorter than its lag — the lookback is the full period, so the seam is exact", () => {
    // 20 bars, then a page of 5 in front, period 12 (> the page): the corrected zone must reach period + signal − 1 back.
    const all = Array.from({ length: 25 }, (_, i) => bar(i, 100 + i + 1, 100 + i - 1, 100 + (i % 7) * 3));
    let data = all.slice(5);
    const source: Source<OHLC> = { read: () => data };
    const node = momentum(source, { period: 12, signal: 1 });
    node.out.momentum.read();
    data = all;
    const landed = ys(node.out.momentum.read());
    const cold = ys(momentum(sourceOf(all), { period: 12, signal: 1 }).out.momentum.read());
    expect(landed).toEqual(cold);
  });

  it("is the close minus the close period bars back, with an sma signal", () => {
    const tape = [10, 12, 11, 15, 14].map((c, i) => bar(i, c + 1, c - 1, c));
    const node = momentum(sourceOf(tape), { period: 2, signal: 2 });
    // [2] 11 − 10 = 1, [3] 15 − 12 = 3, [4] 14 − 11 = 3; signal sma2: [3] 2, [4] 3
    expect(ys(node.out.momentum.read())).toEqual([null, null, 1, 3, 3]);
    expect(ys(node.out.signal.read())).toEqual([null, null, null, 2, 3]);
  });
});

describe("elderRay", () => {
  it("is high and low against the ema of the close", () => {
    // period 1: ema = close → bull = high − close, bear = low − close
    const tape = [bar(0, 12, 8, 10), bar(1, 15, 9, 11)];
    const node = elderRay(sourceOf(tape), { period: 1 });
    expect(ys(node.out.bullPower.read())).toEqual([2, 4]);
    expect(ys(node.out.bearPower.read())).toEqual([-2, -2]);
  });

  it("waits for the ema's seed", () => {
    const tape = [bar(0, 12, 8, 10), bar(1, 15, 9, 12), bar(2, 16, 10, 14)];
    const node = elderRay(sourceOf(tape), { period: 2 });
    // ema(2) seeds at [1] with (10+12)/2 = 11; [2]: 14·(2/3) + 11·(1/3) = 13
    expect(ys(node.out.bullPower.read())).toEqual([null, 4, 3]);
    expect(ys(node.out.bearPower.read())).toEqual([null, -2, -3]);
  });
});

/**
 * LazyBear's script, written out over arrays — the oracle the fold node is held to. Its means,
 * deviations and extremums come from the package's own array kernels (the folds the node runs),
 * so those parts check the composition; the regression and the squeeze states are written out.
 */
function squeezeReference(
  tape: readonly OHLC[],
  bb: number,
  bbMult: number,
  kc: number,
  kcMult: number,
  lazyBearDeviation = false,
) {
  const closes = tape.map((c) => c.close);
  const trueRanges: (number | null)[] = tape.map((c, i) =>
    i === 0 ? null : Math.max(c.high - c.low, Math.abs(c.high - tape[i - 1].close), Math.abs(c.low - tape[i - 1].close)),
  );
  const bbMean = sma(closes, bb);
  const bbDev = stddev(closes, bb);
  const kcMean = sma(closes, kc);
  const kcRange = sma(trueRanges, kc);
  const top = highest(tape.map((c) => c.high), kc);
  const bottom = lowest(tape.map((c) => c.low), kc);
  const deviation = closes.map((close, i) => {
    const t = top[i];
    const b = bottom[i];
    const m = kcMean[i];
    return t === null || b === null || m === null ? null : close - ((t + b) / 2 + m) / 2;
  });
  const momentum: (number | null)[] = deviation.map((_, end) => {
    if (end < kc - 1) return null;
    const window = deviation.slice(end - kc + 1, end + 1);
    if (window.some((v) => v === null)) return null;
    const ys = window.map((v) => v ?? 0);
    const n = kc;
    const kBar = (n - 1) / 2;
    const yBar = ys.reduce((a, b) => a + b, 0) / n;
    let cov = 0;
    let den = 0;
    for (let k = 0; k < n; k++) {
      cov += (k - kBar) * (ys[k] - yBar);
      den += (k - kBar) * (k - kBar);
    }
    return n === 1 ? ys[0] : yBar + (cov / den) * (n - 1 - kBar);
  });
  const state = closes.map((_, i) => {
    const m = bbMean[i];
    const dev = bbDev[i];
    const km = kcMean[i];
    const kr = kcRange[i];
    if (m === null || dev === null || km === null || kr === null) return "warmup";
    const mult = lazyBearDeviation ? kcMult : bbMult;
    const upperBB = m + mult * dev;
    const lowerBB = m - mult * dev;
    const upperKC = km + kcMult * kr;
    const lowerKC = km - kcMult * kr;
    if (lowerBB > lowerKC && upperBB < upperKC) return "on";
    if (lowerBB < lowerKC && upperBB > upperKC) return "off";
    return "none";
  });
  return { momentum, state };
}

describe("squeezeMomentum", () => {
  const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 6) * 6 + Math.sin(i / 23) * 12 + (i % 4));
  const tape = closes.map((c, i) => bar(i, c + 1.5 + (i % 3), c - 1 - (i % 5) * 0.4, c));

  it("is the script's momentum and squeeze states — held to an array oracle built on the package's own kernels", () => {
    const options = { bbPeriod: 10, bbMultiplier: 2, kcPeriod: 8, kcMultiplier: 1.5 };
    const node = squeezeMomentum(sourceOf(tape), options);
    const want = squeezeReference(tape, 10, 2, 8, 1.5);
    const momentum = ys(node.out.momentum.read());
    for (let i = 0; i < tape.length; i++) {
      const w = want.momentum[i];
      if (w === null) expect(momentum[i], `momentum[${i}]`).toBeNull();
      else expect(Math.abs((momentum[i] ?? Number.NaN) - w), `momentum[${i}]`).toBeLessThan(1e-9 * Math.max(1, Math.abs(w)));
    }
    const on = ys(node.out.squeezeOn.read());
    const off = ys(node.out.squeezeOff.read());
    for (let i = 0; i < tape.length; i++) {
      expect(on[i], `on[${i}]`).toBe(want.state[i] === "on" ? 0 : null);
      expect(off[i], `off[${i}]`).toBe(want.state[i] === "off" ? 0 : null);
    }
  });

  it("the momentum bars carry their direction as tone; the marker rows carry none", () => {
    expectTonedLikeCold(tape, (s) => squeezeMomentum(s, { bbPeriod: 10, kcPeriod: 8 }).out.momentum);
    const node = squeezeMomentum(sourceOf(tape), { bbPeriod: 10, kcPeriod: 8 });
    for (const point of node.out.squeezeOn.read()) expect("tone" in point).toBe(false);
    for (const point of node.out.squeezeOff.read()) expect("tone" in point).toBe(false);
  });

  it("turns on in a calm, wide-ranged stretch and off in a narrow, trending one", () => {
    // 40 flat closes on wide bars (σ ≈ 0, true range 4) → Bollinger inside Keltner → on;
    // then 40 closes climbing 5 a bar on narrow bars (σ large, true range ≈ 5.5) → Bollinger outside → off.
    const calm = Array.from({ length: 40 }, (_, i) => bar(i, 102, 98, 100));
    const trend = Array.from({ length: 40 }, (_, i) => bar(40 + i, 100 + 5 * (i + 1) + 0.5, 100 + 5 * (i + 1) - 0.5, 100 + 5 * (i + 1)));
    const node = squeezeMomentum(sourceOf([...calm, ...trend]), { bbPeriod: 10, bbMultiplier: 2, kcPeriod: 10, kcMultiplier: 1.5 });
    const on = ys(node.out.squeezeOn.read());
    const off = ys(node.out.squeezeOff.read());
    expect(on[30]).toBe(0);
    expect(off[30]).toBeNull();
    expect(off[79]).toBe(0);
    expect(on[79]).toBeNull();
    // Warmup: neither.
    expect(on[3]).toBeNull();
    expect(off[3]).toBeNull();
  });

  it("with equal multipliers matches the script's screen, whose Bollinger deviation takes the Keltner multiplier", () => {
    const node = squeezeMomentum(sourceOf(tape), { bbPeriod: 10, bbMultiplier: 1.5, kcPeriod: 8, kcMultiplier: 1.5 });
    const script = squeezeReference(tape, 10, 2 /* declared, unused by the script */, 8, 1.5, true);
    const on = ys(node.out.squeezeOn.read());
    for (let i = 0; i < tape.length; i++) expect(on[i], `on[${i}]`).toBe(script.state[i] === "on" ? 0 : null);
  });

  it("rejects a multiplier that is not a positive finite number — like Bollinger and Keltner do", () => {
    expect(() => squeezeMomentum(sourceOf(tape), { bbMultiplier: Number.NaN })).toThrow(ContractError);
    expect(() => squeezeMomentum(sourceOf(tape), { kcMultiplier: 0 })).toThrow(ContractError);
    expect(() => squeezeMomentum(sourceOf(tape), { kcMultiplier: -1.5 })).toThrow(ContractError);
  });

  it("a short squeeze survives zoom-out decimation — the run is its own gap-free segment", () => {
    // 5,000 bars of "off", a 5-bar "on" run in the middle, decimated to a
    // budget of 100 points (a 25-pixel viewport at the default 4 per pixel).
    const on: LineDataPoint[] = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i >= 2500 && i < 2505 ? 0 : null }));
    const kept = new M4Decimation<LineDataPoint>().decimate(on, { start: 0, end: on.length }, 100);
    expect(kept.some((p) => p.y === 0 && p.x >= 2500 && p.x < 2505)).toBe(true);
  });
});
