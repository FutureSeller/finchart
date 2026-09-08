import { readFileSync } from "node:fs";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  emaFold,
  highest,
  highestFold,
  lagFold,
  linregFold,
  lowest,
  lowestFold,
  rmaFold,
  seededRmaFold,
  sma,
  smaFold,
  stddev,
  stddevFold,
  sumFold,
} from "../kernels";

/**
 * Every fold agrees with its array form on every input — pseudo-random
 * sequences with a gap at each position in turn — bit for bit, except
 * `linregFold`, whose centered fit is a different arithmetic from the
 * reference's uncentered one (tolerance, stated). And a fold resumed from a snapshot continues
 * exactly as one that never stopped: the checkpoint is the whole state.
 */

function sequence(seed: number, length: number): number[] {
  let s = seed;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(100 + (s / 2147483648) * 20 - 10 + Math.sin(i / 3));
  }
  return out;
}

function withGap(values: readonly number[], at: number): (number | null)[] {
  return values.map((v, i) => (i === at ? null : v));
}

function run(fold: { step(v: number | null): number | null }, values: readonly (number | null)[]) {
  return values.map((v) => fold.step(v));
}

/** Runs the fold, but from `splitAt` on continues on a second fold restored from a snapshot. */
function runResumed<S>(
  make: () => { step(v: number | null): number | null; snapshot(): S; restore(s: S): void },
  values: readonly (number | null)[],
  splitAt: number,
) {
  const first = make();
  const out: (number | null)[] = [];
  for (let i = 0; i < splitAt; i++) out.push(first.step(values[i]));
  const checkpoint = first.snapshot();
  // Keep stepping the first fold — the snapshot must be a copy, not a view.
  first.step(999);
  const second = make();
  second.restore(checkpoint);
  for (let i = splitAt; i < values.length; i++) out.push(second.step(values[i]));
  return out;
}

const base = sequence(7, 60);
const inputs: (number | null)[][] = [base, ...Array.from({ length: base.length }, (_, i) => withGap(base, i))];

/** A fresh sum over a full window, oldest first — the order the fold uses. */
function sumReference(values: readonly (number | null)[], period: number): (number | null)[] {
  return values.map((_, end) => {
    if (end < period - 1) return null;
    const window = values.slice(end - period + 1, end + 1);
    if (window.some((v) => v === null)) return null;
    return window.reduce<number>((a, v) => a + (v ?? 0), 0);
  });
}

/**
 * The mean of `count` doubles from `start`, exact up to two roundings: each normal double is an
 * integer times a power of two, so their sum is exact in a BigInt at a common scale (2⁶⁰ —
 * enough for any magnitude at or above 2⁻⁸), and only the conversion to a double and the
 * division round — a reference the fold under test cannot share rounding with. Normal doubles
 * only; the tapes here have none of the subnormals it would misread.
 */
function ulp(value: number): number {
  return 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52);
}

function exactMean(values: readonly number[], start: number, count: number): number {
  const view = new DataView(new ArrayBuffer(8));
  const scale = 60n;
  let sum = 0n;
  for (let k = start; k < start + count; k++) {
    view.setFloat64(0, values[k]);
    const bits = view.getBigUint64(0);
    const exponent = Number((bits >> 52n) & 0x7ffn) - 1075;
    const mantissa = (bits & ((1n << 52n) - 1n)) | (1n << 52n);
    const sign = bits >> 63n === 0n ? 1n : -1n;
    sum += sign * mantissa * (1n << (BigInt(exponent) + scale));
  }
  return Number(sum) / 2 ** Number(scale) / count;
}

describe("every fold takes a non-finite input as no observation", () => {
  // Finite inputs whose arithmetic left the double range arrive here as Infinity or NaN —
  // a signal window fed one would keep it in its running state (Infinity − Infinity = NaN) for good.
  const folds: [string, () => { step(v: number | null): number | null }][] = [
    ["smaFold", () => smaFold(2)],
    ["sumFold", () => sumFold(2)],
    ["emaFold", () => emaFold(2)],
    ["rmaFold", () => rmaFold(2)],
    ["stddevFold", () => stddevFold(2)],
    ["lagFold", () => lagFold(1)],
    ["highestFold", () => highestFold(2)],
    ["linregFold", () => linregFold(2)],
  ];
  it.each(folds)("%s — Infinity and NaN are null, and the fold recovers", (_name, make) => {
    const poisoned = run(make(), [1, 2, Number.POSITIVE_INFINITY, 3, 4, 5]);
    const clean = run(make(), [1, 2, null, 3, 4, 5]);
    expect(poisoned).toEqual(clean);
    expect(run(make(), [1, Number.NaN, 2, 3])).toEqual(run(make(), [1, null, 2, 3]));
  });
});

describe("a recursion commits only finite, non-saturated state", () => {
  it.each([["emaFold", emaFold], ["rmaFold", rmaFold]] as const)(
    "%s — a seed that finite inputs push past the double range is dropped, and the recursion seeds afresh",
    (_name, make) => {
      // 1e308 + 1e308 overflows the seed sum: the running-total form committed Infinity for good.
      expect(run(make(2), [1e308, 1e308, 1, 2, 3])).toEqual([null, null, null, 1.5, expect.any(Number)]);
      const out = run(make(2), [1e308, 1e308, 1, 2, 3]);
      expect(out.every((v) => v === null || Number.isFinite(v))).toBe(true);
      // Two halves of the largest double sum to exactly MAX_VALUE — finite, but saturated: the seed restarts.
      const half = Number.MAX_VALUE / 2;
      expect(run(make(2), [half, half, 1, 2])).toEqual([null, null, null, 1.5]);
    },
  );
});

describe("seededRmaFold — a recursion that starts at a constant", () => {
  it("applies the recurrence from the first observation — a first 80 over 3 from 50 reads 60, then 53.3 for a second recursion over it", () => {
    const k = seededRmaFold(3, 50);
    const d = seededRmaFold(3, 50);
    const first = k.step(80);
    expect(first).toBe((50 * 2 + 80) / 3);
    expect(d.step(first)).toBe((50 * 2 + 60) / 3);
    // Seeding with the sma of the first three, as rmaFold does, would read null, null, then the mean — not this.
    expect(run(rmaFold(3), [80, 80, 80])).toEqual([null, null, 80]);
    expect(run(seededRmaFold(3, 50), [80, 80, 80])).toEqual([60, (60 * 2 + 80) / 3, (((60 * 2 + 80) / 3) * 2 + 80) / 3]);
  });

  it("a null input is no reading and leaves the state where it was — memory is counted in observations, not bars", () => {
    const fold = seededRmaFold(2, 50);
    expect(run(fold, [100, null, null, 100])).toEqual([75, null, null, 87.5]);
  });

  it("a step that leaves the range is no reading and no state; snapshot and restore round-trip", () => {
    const fold = seededRmaFold(2, 1e308);
    expect(fold.step(Number.MAX_VALUE)).toBeNull(); // not an observation — the state is untouched
    expect(fold.step(1e308)).toBeNull(); // (1e308·1 + 1e308) leaves the range: no reading, no state
    const checkpoint = fold.snapshot();
    expect(checkpoint.state).toBe(1e308);
    expect(fold.step(1)).toBe((1e308 + 1) / 2); // continues from the kept state
    fold.restore(checkpoint);
    expect(fold.step(1)).toBe((1e308 + 1) / 2);
  });

  it("refuses a seed the recursion could not have reached", () => {
    expect(() => seededRmaFold(3, Number.POSITIVE_INFINITY)).toThrow(ContractError);
    expect(() => seededRmaFold(3, Number.MAX_VALUE)).toThrow(ContractError);
    expect(() => seededRmaFold(0, 50)).toThrow(ContractError);
  });
});

describe("a recursion step that saturates is no reading", () => {
  it.each([["emaFold", emaFold], ["rmaFold", rmaFold]] as const)("%s", (_name, make) => {
    // With period 1 the step is the value itself: the largest double is no reading.
    expect(run(make(1), [1, Number.MAX_VALUE, 2])).toEqual([1, null, 2]);
  });

  it("rmaFold's literal recurrence can overflow on committable inputs — the step is skipped, the state kept", () => {
    // ((period − 1)·state + value) / period forms the numerator first: 2·5e307 + 1.7e308 leaves
    // the range. (emaFold's value·α + state·(1 − α) form does not on the same inputs: its two
    // products are 8.5e307 and 2.5e307.)
    expect(run(rmaFold(3), [5e307, 5e307, 5e307, 1.7e308, 1])).toEqual([null, null, 5e307, null, (5e307 * 2 + 1) / 3]);
    expect(run(emaFold(3), [5e307, 5e307, 5e307, 1.7e308])).toEqual([null, null, 5e307, 1.1e308]);
  });
});

describe("the array extremums are the folds in a loop", () => {
  it("highest/lowest take a non-finite input as no observation, like their folds", () => {
    expect(highest([1, Number.POSITIVE_INFINITY, 2, 3], 2)).toEqual(highest([1, null, 2, 3], 2));
    expect(lowest([1, Number.NaN, 2, 3], 2)).toEqual(lowest([1, null, 2, 3], 2));
  });
});

describe("gradual underflow is rounding, not a door", () => {
  it("a mean or a recursion that rounds to 0 reads 0 and carries on", () => {
    // The cases: MIN_VALUE / 2 rounds to 0 — the window mean and the seeded recursion both read
    // that 0, and the recursion's state is that 0 (5e-324 from exact — rounding, not corruption).
    expect(run(smaFold(2), [Number.MIN_VALUE, 0])).toEqual([null, 0]);
    expect(run(rmaFold(2), [Number.MIN_VALUE, 0, 0])).toEqual([null, 0, 0]);
    expect(run(emaFold(3), [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE])).toEqual([null, null, Number.MIN_VALUE, 0]);
  });
});

describe("a computed window result that is not committable is null", () => {
  const half = Number.MAX_VALUE / 2;
  it("committable inputs whose window computation leaves the range or saturates", () => {
    // Every input here passes the observation door (half the largest double); only what the
    // window computes from them does not — the sum lands exactly on the largest double, the
    // squared deviations overflow, the regression's sum of values shifted to the newest
    // (−MAX twice) overflows before its slope is formed.
    expect(run(sumFold(2), [half, half, 1, 1])).toEqual([null, null, half + 1, 2]);
    expect(run(smaFold(2), [half, half, 1, 1])).toEqual([null, null, (half + 1) / 2, 1]);
    expect(run(stddevFold(2), [-half, half, 1, 1])).toEqual([null, null, null, 0]);
    expect(run(linregFold(4), [-half, -half, half, half])).toEqual([null, null, null, null]);
  });

  it("a saturated input is no observation — before any computation", () => {
    expect(run(linregFold(3), [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE])).toEqual([null, null, null]);
    expect(run(stddevFold(2), [-Number.MAX_VALUE, Number.MAX_VALUE])).toEqual([null, null]);
    // So a carried one can never be the largest double.
    expect(run(lagFold(1), [Number.MAX_VALUE, 1])).toEqual([null, null]);
    // Handed to a signal window it would have averaged with its negative to a wrong 0.
    expect(run(smaFold(2), [Number.MAX_VALUE, -Number.MAX_VALUE, 1, 1])).toEqual([null, null, null, 1]);
  });
});

describe("smaFold — a window mean recomputed each step", () => {
  it("stays within 16 ULP of the shipped running-total kernel's golden output on a 400-bar tape with gaps", () => {
    // Dumped at 04dc50c before the rewrite. Over this short tape the two forms differ by at
    // most 13 ULP (period 20; 4 at period 2, 11 at period 5) — each form's own window rounding
    // plus the drift the running total had accumulated by then. Over a long tape that drift
    // grows with history while the window sum's error does not (the next test measures it
    // against the exact window mean) — so a long tape parts further from the golden, as a
    // correction, not a compatibility cost. (The rewrite also fixes the residual a departing
    // outlier leaves behind.)
    const golden = JSON.parse(readFileSync(new URL("./fixtures/sma-golden.json", import.meta.url), "utf8")) as {
      values: (number | null)[];
      periods: number[];
      outputs: (number | null)[][];
    };
    golden.periods.forEach((period, k) => {
      const got = sma(golden.values, period);
      const want = golden.outputs[k];
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        const w = want[i];
        if (w === null) expect(got[i], `sma(${period})[${i}]`).toBeNull();
        else expect(Math.abs((got[i] ?? Number.NaN) - w), `sma(${period})[${i}]`).toBeLessThanOrEqual(16 * ulp(w));
      }
    });
  });

  // A million bars under coverage instrumentation runs past vitest's 5 s default — the length is the point.
  it("stays within the window's own rounding of the exact mean after a million bars — no drift with history", { timeout: 60_000 }, () => {
    // The forward error of summing `period` doubles in order is at most (period − 1)·u·Σ|x| to
    // first order, u = 2⁻⁵³ — a bound on the window alone, with nothing about how many bars came
    // before. The test takes ε = 2u, which also covers the reference's own two roundings (the
    // BigInt-to-double conversion and the division). A running total's error is a bound on the
    // whole tape instead. Replaying the 04dc50c kernel on this tape against the same reference:
    // period 10 first exceeds its bound (1.8e-13 at that bar) at bar 4994 and reaches 1.0e-11 by a
    // million bars; period 50, with a wider bound (about 1.1e-12), first exceeds it at bar
    // 550393 (1.11e-12 against 1.07e-12) and peaks at 1.19e-12. The window sum's worst error on
    // the same points is 7.1e-14.
    const bars = 1_000_000;
    const values = new Array<number>(bars);
    for (let i = 0; i < bars; i++) {
      values[i] = 100 + 0.000002 * i + 12 * Math.sin(i / 17) + 3 * Math.cos(i / 113) + (i % 7) * 0.003;
    }
    const epsilon = 2 ** -52;
    for (const period of [10, 50]) {
      const got = sma(values, period);
      for (let end = period - 1; end < bars; end += 997) {
        let sumOfMagnitudes = 0;
        for (let k = end - period + 1; k <= end; k++) sumOfMagnitudes += Math.abs(values[k]);
        const bound = ((period - 1) * epsilon * sumOfMagnitudes) / period;
        const want = exactMean(values, end - period + 1, period);
        expect(Math.abs((got[end] ?? Number.NaN) - want), `sma(${period})[${end}]`).toBeLessThanOrEqual(bound);
      }
    }
  });

  it("does not carry a departing outlier's residual — `[1e20, 1, 1, 1]` over 3 reads exactly 1", () => {
    expect(run(smaFold(3), [1e20, 1, 1, 1])).toEqual([null, null, (1e20 + 2) / 3, 1]);
  });

  it("a window whose sum overflows has no mean, and the fold recovers when the window moves on", () => {
    // The running-total form kept Infinity in its state for good; the recomputed form has no state but the ring.
    expect(run(smaFold(2), [1e308, 1e308, 1, 1])).toEqual([null, null, 5e307, 1]);
  });
});

describe("sumFold ↔ a fresh window sum", () => {
  it.each([1, 3, 7])("period %i — bit for bit, gap at every position", (period) => {
    for (const values of inputs) {
      expect(run(sumFold(period), values)).toEqual(sumReference(values, period));
    }
  });

  it("agrees with sma × period on ordinary data to 1e-9 — sma over a window", () => {
    for (const values of inputs) {
      const want = sma(values, 5);
      const got = run(sumFold(5), values);
      for (let i = 0; i < want.length; i++) {
        const w = want[i];
        if (w === null) expect(got[i]).toBeNull();
        else expect(Math.abs((got[i] ?? Number.NaN) / 5 - w)).toBeLessThan(1e-9);
      }
    }
  });

  it("a departing 1e20 leaves the ones intact — a running total would have rounded them away", () => {
    expect(run(sumFold(3), [1e20, 1, 1, 1])).toEqual([null, null, 1e20, 3]);
  });

  it("a window whose sum leaves the double range has no sum — null, not Infinity", () => {
    // Every input is finite; only their sum is not. A downstream ratio of two such
    // sums would read NaN, and the line-data contract is finite-or-null.
    expect(run(sumFold(2), [1e308, 1e308, 1, 1])).toEqual([null, null, 1e308, 2]);
    // A sum of two committable halves that lands exactly on the largest double has stopped
    // being a sum — for the mean too. (The largest double as an input is refused earlier, at
    // the observation door.)
    expect(run(sumFold(2), [Number.MAX_VALUE / 2, Number.MAX_VALUE / 2, 4])).toEqual([null, null, Number.MAX_VALUE / 2 + 4]);
    expect(run(smaFold(2), [Number.MAX_VALUE / 2, Number.MAX_VALUE / 2, 0, 4])).toEqual([null, null, Number.MAX_VALUE / 4, 2]);
  });

  it("resumes from a snapshot exactly", () => {
    for (const values of inputs) {
      expect(runResumed(() => sumFold(5), values, 17)).toEqual(run(sumFold(5), values));
    }
  });

  it("rejects a nonsense period like its siblings", () => {
    expect(() => sumFold(0)).toThrow(ContractError);
  });
});

describe("highestFold / lowestFold ↔ highest / lowest", () => {
  it.each([1, 3, 8])("period %i — including the tie rule", (period) => {
    const ties = base.map((v, i) => (i % 4 === 0 ? 105 : v));
    for (const values of [...inputs, ties]) {
      expect(run(highestFold(period), values)).toEqual(highest(values, period));
      expect(run(lowestFold(period), values)).toEqual(lowest(values, period));
    }
  });

  it("resumes from a snapshot exactly — the deque is part of the state", () => {
    for (const values of inputs) {
      expect(runResumed(() => highestFold(6), values, 23)).toEqual(run(highestFold(6), values));
      expect(runResumed(() => lowestFold(6), values, 5)).toEqual(run(lowestFold(6), values));
    }
  });
});

/** The stable two-pass population standard deviation over a full window — shifted to its first value so the sums are taken at the spread's size. */
function stddevReference(window: readonly number[]): number {
  const n = window.length;
  const origin = window[0];
  const shifted = window.map((y) => y - origin);
  const mean = shifted.reduce((a, b) => a + b, 0) / n;
  const squares = shifted.reduce((a, y) => a + (y - mean) * (y - mean), 0);
  return Math.sqrt(squares / n);
}

describe("stddevFold ↔ stddev", () => {
  it("period 1 is always 0; period 2 is half the gap", () => {
    expect(run(stddevFold(1), [7, null, 1e20])).toEqual([0, null, 0]);
    expect(run(stddevFold(2), [1, 3, 3])).toEqual([null, 1, 0]);
  });

  it.each([2, 5, 20])("period %i — bit for bit (the array is the fold in a loop)", (period) => {
    for (const values of inputs) {
      expect(run(stddevFold(period), values)).toEqual(stddev(values, period));
    }
  });

  it.each([2, 5, 20])("period %i — within relative 1e-9 of a two-pass reference, gap at every position", (period) => {
    for (const values of inputs) {
      const got = run(stddevFold(period), values);
      for (let end = period - 1; end < values.length; end++) {
        const window = values.slice(end - period + 1, end + 1);
        if (window.some((v) => v === null)) {
          expect(got[end], `[${end}]`).toBeNull();
          continue;
        }
        const want = stddevReference(window.map((v) => v ?? 0));
        expect(Math.abs((got[end] ?? Number.NaN) - want), `[${end}]`).toBeLessThanOrEqual(1e-9 * Math.max(1, want));
      }
    }
  });

  it("two departures in a row, each dwarfing what remains — the period-3 sequence that slipped a guard", () => {
    const got = run(stddevFold(3), [0, 1e12, 1e9, 0, 1e6, 1e6]);
    const want = stddevReference([0, 1e6, 1e6]);
    expect(Math.abs((got[5] ?? Number.NaN) - want) / want).toBeLessThan(1e-12);
  });

  it("keeps its digits when the spread is tiny next to the level, over a long run", () => {
    // 200k values near 1e6 with a spread of ~10: the Σy²/n − mean² form
    // came out several hundred percent wrong after a long run (measured).
    const fold = stddevFold(20);
    const window: number[] = [];
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      const value = 1e6 + Math.sin(i * 0.017) * 10 + Math.cos(i * 0.113);
      const got = fold.step(value);
      window.push(value);
      if (window.length > 20) window.shift();
      if (i >= 19 && i % 991 === 0) {
        const want = stddevReference(window);
        worst = Math.max(worst, Math.abs((got ?? Number.NaN) - want) / want);
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("a trending level stays within 1e-9 — the origin is the window's own oldest value", () => {
    // 200k steps climbing 1e6 → 3e6.
    const fold = stddevFold(20);
    const window: number[] = [];
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      const value = 1e6 + i * 10 + Math.sin(i * 0.31) * 3;
      const got = fold.step(value);
      window.push(value);
      if (window.length > 20) window.shift();
      if (i >= 19 && i % 991 === 0) {
        const want = stddevReference(window);
        worst = Math.max(worst, Math.abs((got ?? Number.NaN) - want) / want);
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("resumes from a snapshot exactly — at several seams", () => {
    for (const values of inputs) {
      for (const splitAt of [30, 34, 35]) {
        expect(runResumed(() => stddevFold(5), values, splitAt), `split ${splitAt}`).toEqual(run(stddevFold(5), values));
      }
    }
  });

  it.each([
    [1e9, 25],
    [1e12, 25],
    [1e20, 25],
    // At 21 the spike spends a step as the oldest value — the sweep's origin — before it leaves.
    [1e20, 21],
    [1e12, 21],
  ])("a departing spike of %s at %i does not cancel the residual spread", (spike, at) => {
    const values = Array.from({ length: 60 }, (_, i) => (i === at ? spike : 1e6 + Math.sin(i * 0.31) * 3));
    const got = run(stddevFold(20), values);
    for (let end = 19; end < values.length; end++) {
      const window = values.slice(end - 19, end + 1);
      const want = stddevReference(window);
      expect(Math.abs((got[end] ?? Number.NaN) - want) / want, `[${end}]`).toBeLessThan(1e-9);
    }
  });
});

describe("lagFold", () => {
  it("answers the value lag steps back, null before that, and a lagged null as null", () => {
    expect(run(lagFold(2), [1, 2, 3, null, 5, 6])).toEqual([null, null, 1, 2, 3, null]);
    expect(run(lagFold(1), [7, 8])).toEqual([null, 7]);
  });

  it("resumes from a snapshot exactly", () => {
    for (const values of inputs) {
      expect(runResumed(() => lagFold(3), values, 11)).toEqual(run(lagFold(3), values));
    }
  });

  it("rejects a lag under one", () => {
    expect(() => lagFold(0)).toThrow(ContractError);
  });
});

/** A fresh least-squares fit over the window — the reference `linregFold` is held to. */
function linregReference(values: readonly (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let end = period - 1; end < values.length; end++) {
    const window = values.slice(end - period + 1, end + 1);
    if (window.some((v) => v === null)) continue;
    const ys = window.map((v) => v ?? 0);
    const n = period;
    let sy = 0;
    let sky = 0;
    for (let k = 0; k < n; k++) {
      sy += ys[k];
      sky += k * ys[k];
    }
    if (n === 1) {
      out[end] = sy;
      continue;
    }
    const sk = (n * (n - 1)) / 2;
    const skk = ((n - 1) * n * (2 * n - 1)) / 6;
    const slope = (n * sky - sk * sy) / (n * skk - sk * sk);
    const intercept = (sy - slope * sk) / n;
    out[end] = intercept + slope * (n - 1);
  }
  return out;
}

describe("linregFold ↔ a fresh fit", () => {
  it.each([1, 2, 5, 20])("period %i — to 1e-9, with a gap at every position", (period) => {
    for (const values of inputs) {
      const want = linregReference(values, period);
      const got = run(linregFold(period), values);
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        const w = want[i];
        const g = got[i];
        if (w === null) {
          expect(g, `[${i}]`).toBeNull();
        } else {
          expect(g, `[${i}]`).not.toBeNull();
          expect(Math.abs((g ?? Number.NaN) - w), `[${i}]`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("resumes from a snapshot exactly — at several seams", () => {
    for (const values of inputs) {
      for (const splitAt of [27, 34, 35]) {
        expect(runResumed(() => linregFold(5), values, splitAt), `split ${splitAt}`).toEqual(run(linregFold(5), values));
      }
    }
  });

  it("does not drift — a long run at a large offset stays within relative 1e-12 of a fresh fit", () => {
    // 200k steps near 1e9. The rolling-sum form wandered off by ~0.2 here
    // (relative 2e-10 — measured); a fresh fit each step has nothing to
    // accumulate.
    const values = sequence(11, 200_000).map((v) => v + 1e9);
    const fold = linregFold(20);
    let maxRelative = 0;
    const window: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const got = fold.step(values[i]);
      window.push(values[i]);
      if (window.length > 20) window.shift();
      if (i >= 19 && i % 997 === 0) {
        const want = linregReference(window, 20)[19];
        if (want === null || got === null) throw new Error(`unexpected null at ${i}`);
        maxRelative = Math.max(maxRelative, Math.abs(got - want) / Math.abs(want));
      }
    }
    expect(maxRelative).toBeLessThan(1e-12);
  });

  it.each([1e9, 1e12, 1e20])("a departing spike of %s does not cancel the sums", (spike) => {
    const values = Array.from({ length: 60 }, (_, i) => (i === 25 ? spike : 1e6 + Math.sin(i * 0.31) * 3));
    const got = run(linregFold(20), values);
    const want = linregReference(values, 20);
    for (let end = 45; end < values.length; end++) {
      const w = want[end];
      if (w === null) throw new Error("unexpected null");
      expect(Math.abs((got[end] ?? Number.NaN) - w) / Math.abs(w), `[${end}]`).toBeLessThan(1e-9);
    }
  });

  it("a trailing 1e20 spike in a long window — within the data's own bound n·max|y|·ε", () => {
    const n = 4096;
    const values = Array.from({ length: n }, (_, i) => (i === n - 1 ? 1e20 : 1_000_000 + i));
    const got = run(linregFold(n), values)[n - 1];
    // Exact end point of that fit (the spike dominates: ≈ 9.76e16).
    const want = linregReference(values, n)[n - 1];
    if (got === null || want === null) throw new Error("unexpected null");
    expect(Math.abs(got - want)).toBeLessThan(2 * n * 1e20 * Number.EPSILON);
    expect(Math.abs(got - want) / want).toBeLessThan(1e-9);
  });

  it("a two-point line ends on its second point — exactly, whatever the first", () => {
    expect(run(linregFold(2), [1e20, 1])).toEqual([null, 1]);
    expect(run(linregFold(2), [3, 7, 2])).toEqual([null, 7, 2]);
    expect(run(linregFold(1), [1e20, 1])).toEqual([1e20, 1]);
  });

  it("a straight line's end point is the line's last value", () => {
    const line = Array.from({ length: 30 }, (_, i) => 3 + 2 * i);
    const got = run(linregFold(10), line);
    for (let i = 9; i < 30; i++) expect(Math.abs((got[i] ?? Number.NaN) - line[i])).toBeLessThan(1e-9);
  });
});
