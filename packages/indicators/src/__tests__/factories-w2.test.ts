import type { OHLC, Source } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { bbi, brar, cr, dma, emv, kdj, psy, pvt, roc, trix, vr } from "../factories";
import { ema, sma } from "../kernels";

/**
 * Wave 2 — the KLineChart parity set. Each indicator is held to a hand
 * calculation, to an oracle written in the order its own JSDoc states (exact —
 * the reading is what that order of double operations gives) and, where the
 * canonical has a window form, to an array oracle written from the canonical
 * source within a tolerance (parity of values, not of rounding; with our null
 * rule where the canonical writes 0 for a case its formula leaves undefined: a
 * missing predecessor, a zero denominator, a zero box-ratio divisor, a gap is
 * "no value", not a reading). Where an oracle averages through this package's
 * own `sma` / `ema` array kernels — signal lines, BBI, DMA, TRIX, CR's
 * averages — those kernels are the same folds the node runs, so that part
 * checks the composition and the default windows, not the averages' values;
 * the kernels' own values are held to hand calculations and fresh references
 * in their own tests.
 */

function bar(i: number, close: number, volume: number | null = 1000): OHLC {
  return { x: i * 60, open: close, high: close + 1, low: close - 1, close, volume };
}
function sourceOf(candles: OHLC[]): Source<OHLC> {
  return { read: () => candles };
}
const ys = (points: readonly { y: number | null }[]) => points.map((p) => p.y);
const closes = (n: number) => Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 4) * 7 + (i % 3) * 0.5);
const expectClose = (got: readonly (number | null)[], want: readonly (number | null)[], label: string) => {
  expect(got.length, `${label} length`).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    if (w === null) expect(got[i], `${label}[${i}]`).toBeNull();
    else expect(Math.abs((got[i] ?? Number.NaN) - w), `${label}[${i}]`).toBeLessThan(1e-9 * Math.max(1, Math.abs(w)));
  }
};

describe("roc", () => {
  it("is the percent change against the close `period` bars back, with an sma signal — by hand", () => {
    const tape = [10, 11, 12, 13].map((c, i) => bar(i, c));
    const node = roc(sourceOf(tape), { period: 1, signal: 2 });
    expectClose(ys(node.out.roc.read()), [null, 10, 100 / 11, 100 / 12], "roc");
    expectClose(ys(node.out.signal.read()), [null, null, (10 + 100 / 11) / 2, (100 / 11 + 100 / 12) / 2], "signal");
  });

  it("a zero close `period` bars back is no reading — null, not 0", () => {
    const tape = [0, 5, 6].map((c, i) => bar(i, c));
    expect(ys(roc(sourceOf(tape), { period: 1, signal: 1 }).out.roc.read())).toEqual([null, null, 20]);
  });

  it("matches the percent change written out over a tape with the default windows — the signal against the package's own sma kernel", () => {
    const c = closes(80);
    const want = c.map((v, i) => (i < 12 || c[i - 12] === 0 ? null : ((v - c[i - 12]) / c[i - 12]) * 100));
    const node = roc(sourceOf(c.map((v, i) => bar(i, v))), {});
    expectClose(ys(node.out.roc.read()), want, "roc");
    expectClose(ys(node.out.signal.read()), sma(want, 6), "signal");
  });
});

describe("trix", () => {
  it("is the percent change of a triple ema — with period 1 the ema is the close itself", () => {
    const tape = [10, 11, 12].map((c, i) => bar(i, c));
    const node = trix(sourceOf(tape), { period: 1, signal: 1 });
    expectClose(ys(node.out.trix.read()), [null, 10, 100 / 11], "trix");
  });

  it("seeds each ema with an sma and chains them — by hand on a linear tape", () => {
    // closes 10,12,…,20 with period 2 (alpha 2/3): ema1 seeds at 11 then runs 13,15,17,19;
    // ema2 seeds at 12 then 14,16,18; ema3 seeds at 13 then 15,17 → changes 2/13 and 2/15.
    const tape = [10, 12, 14, 16, 18, 20].map((c, i) => bar(i, c));
    const node = trix(sourceOf(tape), { period: 2, signal: 1 });
    expectClose(ys(node.out.trix.read()), [null, null, null, null, 200 / 13, 200 / 15], "trix");
  });

  it("chains three sma-seeded emas, then the one-bar change, then the signal sma — the composition and default windows against the package's own ema and sma kernels", () => {
    const c = closes(120);
    const tr = ema(ema(ema(c, 12), 12), 12);
    const want = tr.map((v, i) => {
      const prev = i > 0 ? tr[i - 1] : null;
      return v === null || prev === null || prev === 0 ? null : ((v - prev) / prev) * 100;
    });
    const node = trix(sourceOf(c.map((v, i) => bar(i, v))), {});
    expectClose(ys(node.out.trix.read()), want, "trix");
    expectClose(ys(node.out.signal.read()), sma(want, 9), "signal");
  });

  it("the first triple-ema value has no predecessor — null, where the canonical writes 0", () => {
    const c = closes(40);
    const first = ys(trix(sourceOf(c.map((v, i) => bar(i, v))), { period: 3, signal: 1 }).out.trix.read());
    // ema(3) seeds at index 2, the second at 4, the third at 6 — the first change is at 7.
    expect(first.slice(0, 7).every((v) => v === null)).toBe(true);
    expect(first[7]).not.toBeNull();
  });
});

describe("psy", () => {
  it("is the share of up-closes in the window — by hand, and the first bar has no predecessor", () => {
    const tape = [1, 2, 1, 3, 3, 4].map((c, i) => bar(i, c));
    const node = psy(sourceOf(tape), { period: 3, signal: 2 });
    // up: [null, 1, 0, 1, 0, 1] → windows [1,0,1] [0,1,0] [1,0,1]
    expectClose(ys(node.out.psy.read()), [null, null, null, 200 / 3, 100 / 3, 200 / 3], "psy");
    expectClose(ys(node.out.signal.read()), [null, null, null, null, 50, 50], "signal");
  });

  it("an unchanged close is not an up-close", () => {
    const tape = [5, 5, 5].map((c, i) => bar(i, c));
    expect(ys(psy(sourceOf(tape), { period: 2, signal: 1 }).out.psy.read())).toEqual([null, null, 0]);
  });

  it("matches the up-close share written out over a tape with the default window — the signal against the package's own sma kernel", () => {
    const c = closes(80);
    const up = c.map((v, i) => (i === 0 ? null : v > c[i - 1] ? 1 : 0));
    const want = up.map((_, i) => {
      if (i < 12) return null;
      const window = up.slice(i - 11, i + 1);
      return window.every((u) => u !== null) ? (window.reduce<number>((s, u) => s + (u ?? 0), 0) / 12) * 100 : null;
    });
    const node = psy(sourceOf(c.map((v, i) => bar(i, v))), {});
    expectClose(ys(node.out.psy.read()), want, "psy");
    expectClose(ys(node.out.signal.read()), sma(want, 6), "signal");
  });
});

describe("bbi", () => {
  it("is the mean of four smas of the close — by hand", () => {
    // closes 1..8, periods [1,2,3,4] at i=3: (4 + 3.5 + 3 + 2.5)/4 = 3.25; at i=7: (8 + 7.5 + 7 + 6.5)/4 = 7.25
    const tape = [1, 2, 3, 4, 5, 6, 7, 8].map((c, i) => bar(i, c));
    const out = ys(bbi(sourceOf(tape), { periods: [1, 2, 3, 4] }).out.bbi.read());
    expectClose(out, [null, null, null, 3.25, 4.25, 5.25, 6.25, 7.25], "bbi");
  });

  it("is the mean of the package's own sma kernel at the four default windows — composition, not the smas' values", () => {
    const c = closes(80);
    const mean = (a: (number | null)[], b: (number | null)[], d: (number | null)[], e: (number | null)[]) =>
      a.map((v, i) => (v === null || b[i] === null || d[i] === null || e[i] === null ? null : (v + b[i]! + d[i]! + e[i]!) / 4));
    const want = mean(sma(c, 3), sma(c, 6), sma(c, 12), sma(c, 24));
    expectClose(ys(bbi(sourceOf(c.map((v, i) => bar(i, v))), {}).out.bbi.read()), want, "bbi");
  });

  it("a periods array that is not exactly four is refused at the door, naming the factory", () => {
    const tape = closes(10).map((v, i) => bar(i, v));
    // Type-checked callers cannot pass these; a JavaScript caller can. Short must not
    // average fewer windows, long must not quietly use four of five.
    for (const periods of [[3, 6], [], [2, 3, 4, 5, 99]]) {
      const bad: unknown = periods;
      expect(() => bbi(sourceOf(tape), { periods: bad as never })).toThrow(ContractError);
      expect(() => bbi(sourceOf(tape), { periods: bad as never })).toThrow(
        `bbi({ periods }) must be exactly four windows, got array(length ${periods.length})`,
      );
    }
    // Not an array at all — an array-like object cannot masquerade, a string is quoted.
    const arrayLike: unknown = { length: 4 };
    expect(() => bbi(sourceOf(tape), { periods: arrayLike as never })).toThrow(/must be exactly four windows, got object/);
    const text: unknown = "3,6,12,24";
    expect(() => bbi(sourceOf(tape), { periods: text as never })).toThrow(/must be exactly four windows, got "3,6,12,24"/);
    // Four windows, one of them not a period — the kernel's own door still answers.
    const badElement: unknown = [3, 6, 0.5, 24];
    expect(() => bbi(sourceOf(tape), { periods: badElement as never })).toThrow(/period must be an integer of at least 1, got 0.5/);
  });
});

describe("dma", () => {
  it("is the fast sma minus the slow sma, with an sma signal — by hand", () => {
    // closes 1..6, fast 1, slow 2: dma = c − (c + c[1])/2 = 0.5 from i=1; signal(2) = 0.5 from i=2
    const tape = [1, 2, 3, 4, 5, 6].map((c, i) => bar(i, c));
    const node = dma(sourceOf(tape), { fast: 1, slow: 2, signal: 2 });
    expectClose(ys(node.out.dma.read()), [null, 0.5, 0.5, 0.5, 0.5, 0.5], "dma");
    expectClose(ys(node.out.signal.read()), [null, null, 0.5, 0.5, 0.5, 0.5], "signal");
  });

  it("is the package's own sma kernel, fast minus slow, with its sma as the signal at the default windows — composition, not the smas' values", () => {
    const c = closes(120);
    const fast = sma(c, 10);
    const slow = sma(c, 50);
    const want = fast.map((v, i) => (v === null || slow[i] === null ? null : v - slow[i]!));
    const node = dma(sourceOf(c.map((v, i) => bar(i, v))), {});
    expectClose(ys(node.out.dma.read()), want, "dma");
    expectClose(ys(node.out.signal.read()), sma(want, 10), "signal");
  });
});

describe("brar", () => {
  const ohlc = (i: number, open: number, high: number, low: number, close: number): OHLC => ({ x: i * 60, open, high, low, close, volume: 1000 });

  it("AR is null while its window's (open − low) sums to 0 — a bar that opened on its low", () => {
    const tape = [ohlc(0, 8, 12, 8, 11), ohlc(1, 10, 13, 9, 12)];
    const node = brar(sourceOf(tape), { period: 1 });
    expect(ys(node.out.ar.read())).toEqual([null, 300]);
  });

  it("AR is the window's (high − open) over (open − low), BR the same against the previous close — by hand", () => {
    // bar1: high−open 3, open−low 1; high−prevClose 2 (=13−11), prevClose−low 2 (=11−9); bar2: 2, 2; 4 (=15−11)… use period 1.
    const tape = [ohlc(0, 10, 12, 8, 11), ohlc(1, 10, 13, 9, 12), ohlc(2, 12, 14, 10, 13)];
    const node = brar(sourceOf(tape), { period: 1 });
    expectClose(ys(node.out.ar.read()), [100, 300, 100], "ar"); // (12−10)/(10−8), (13−10)/(10−9), (14−12)/(12−10)
    expectClose(ys(node.out.br.read()), [null, 100, 100], "br"); // (13−11)/(11−9), (14−12)/(12−10)
  });

  it("BR clips each bar's gap contribution at 0 — a gap up counts nothing against, a gap down nothing for", () => {
    // bar1 gaps up: low 20 > prevClose 11 → prevClose−low = −9 is clipped to 0, so BR's window denominator is 0 → null.
    // The canonical sums the signed −9 and reads a negative BR.
    const tape = [ohlc(0, 10, 12, 8, 11), ohlc(1, 21, 24, 20, 22)];
    expect(ys(brar(sourceOf(tape), { period: 1 }).out.br.read())).toEqual([null, null]);
    // Over a window of two the gap bar contributes only its high side: (13−11 + 24−12)/(11−9 + 0) = 14/2.
    const two = [ohlc(0, 10, 12, 8, 11), ohlc(1, 10, 13, 9, 12), ohlc(2, 21, 24, 20, 22)];
    expectClose(ys(brar(sourceOf(two), { period: 2 }).out.br.read()), [null, null, ((13 - 11 + (24 - 12)) / (11 - 9 + 0)) * 100], "br");
  });

  it("matches window sums written out over a tape with the default window (BR clipped)", () => {
    const c = closes(80);
    const tape = c.map((v, i) => ohlc(i, v - 0.3 + (i % 2), v + 1 + (i % 3) * 0.4, v - 1 - (i % 5) * 0.3, v));
    const n = 26;
    const ho = tape.map((b) => b.high - b.open);
    const ol = tape.map((b) => b.open - b.low);
    const hcy = tape.map((b, i) => (i === 0 ? null : Math.max(0, b.high - tape[i - 1].close)));
    const cyl = tape.map((b, i) => (i === 0 ? null : Math.max(0, tape[i - 1].close - b.low)));
    const windowSum = (a: (number | null)[], i: number) => {
      if (i < n - 1) return null;
      const w = a.slice(i - n + 1, i + 1);
      return w.every((v) => v !== null) ? w.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
    };
    const ratio = (num: (number | null)[], den: (number | null)[]) =>
      num.map((_, i) => {
        const a = windowSum(num, i);
        const b = windowSum(den, i);
        return a === null || b === null || b === 0 ? null : (a / b) * 100;
      });
    const node = brar(sourceOf(tape), {});
    expectClose(ys(node.out.ar.read()), ratio(ho, ol), "ar");
    expectClose(ys(node.out.br.read()), ratio(hcy, cyl), "br");
  });
});

describe("vr", () => {
  const traded = (i: number, close: number, volume: number | null) => bar(i, close, volume);

  it("weighs up, down and flat volume — by hand", () => {
    // closes 10,11,11,10,12 · volumes 100,200,300,400,500 · period 4 at i=4: up 200+500, down 400, flat 300
    const tape = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 11, 300), traded(3, 10, 400), traded(4, 12, 500)];
    const node = vr(sourceOf(tape), { period: 4, signal: 1 });
    expectClose(ys(node.out.vr.read()), [null, null, null, null, ((700 + 150) / (400 + 150)) * 100], "vr");
  });

  it("an all-flat window reads 100 — and is no reading, not NaN, when its volumes sum past the double limit", () => {
    const tape = [traded(0, 10, 1000), traded(1, 10, 1000), traded(2, 10, 1000)];
    expect(ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read())).toEqual([null, null, 100]);
    // The two flat volumes sum past Number.MAX_VALUE: the window has no sum, so there is no ratio.
    const huge = [traded(0, 10, 1e308), traded(1, 10, 1e308), traded(2, 10, 1e308)];
    const out = ys(vr(sourceOf(huge), { period: 2, signal: 1 }).out.vr.read());
    expect(out).toEqual([null, null, null]);
    expect(out.every((v) => v === null || Number.isFinite(v))).toBe(true);
  });

  it("the ratio is scale-invariant — sums near the double limit still divide correctly", () => {
    // up 5e307, down 1.4e308, flat 1e308 over a window of 3: (5e307 + 5e307)/(1.4e308 + 5e307) = 52.63…
    // Added as they are, the denominator overflows to Infinity and, ×100, so does the numerator: Infinity
    // over Infinity is NaN — no reading at all, where the ratio itself is an ordinary 52.63.
    const tape = [traded(0, 10, 100), traded(1, 11, 5e307), traded(2, 10, 1.4e308), traded(3, 10, 1e308)];
    const out = ys(vr(sourceOf(tape), { period: 3, signal: 1 }).out.vr.read());
    expect(Math.abs((out[3] ?? Number.NaN) / (100 / 1.9) - 1)).toBeLessThan(1e-9); // 1.9e308 itself is not a double
  });

  it("a side that lands exactly on the largest double is scaled too — saturated is not a sum", () => {
    // up = MAX − ulp and flat = 2 ulp: up + flat/2 = MAX_VALUE exactly — finite, but ×100 would overflow it.
    // The scaled path forms the ratio: ≈ 100 × MAX / (1e308 + ulp).
    const ulp = 2 ** 971;
    const up = 1.7976931348623155e308, down = 1e308, flat = 2 * ulp;
    const tape = [traded(0, 10, 100), traded(1, 11, up), traded(2, 10, down), traded(3, 10, flat)];
    const out = ys(vr(sourceOf(tape), { period: 3, signal: 1 }).out.vr.read());
    const want = 100 * (Number.MAX_VALUE / (down + ulp)); // formed so the expectation itself stays in range
    expect(Math.abs((out[3] ?? Number.NaN) / want - 1)).toBeLessThan(1e-9);
  });

  it("a tiny ratio keeps its digits — scaling is only for sums the double range cannot add", () => {
    // up 1e-17 over down 1e308: (1e-17 × 100) / 1e308 = 1e-323 is a representable subnormal; dividing
    // the sums by their maximum first would round the numerator to 0 and lose it.
    const tape = [traded(0, 10, 100), traded(1, 11, 1e-17), traded(2, 10, 1e308)];
    const out = ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read());
    expect(out[2]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(1e-320);
  });

  it("a half-flat that rounds to 0 is rounding — the ratio reads what the doubles give", () => {
    // up 0, down 1, flat Number.MIN_VALUE: flat/2 rounds to 0, so the ratio reads 0 where the exact value
    // is ≈ 2.5e-322. Gradual underflow is rounding, not a gap: the reading stands.
    const tape = [traded(0, 10, 100), traded(1, 9, 1), traded(2, 9, Number.MIN_VALUE)];
    expect(ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read())[2]).toBe(0);
    // up MIN_VALUE, down 0, flat MIN_VALUE: the denominator rounds to 0 — not the undefined case (the
    // window has flat volume) but arithmetic: the ratio leaves the range, and that is why the bar is null.
    const rounded = [traded(0, 10, 100), traded(1, 11, Number.MIN_VALUE), traded(2, 11, Number.MIN_VALUE)];
    expect(ys(vr(sourceOf(rounded), { period: 2, signal: 1 }).out.vr.read())[2]).toBeNull();
  });

  it("a ratio that rounds to 0 is a reading, and the signal averages it", () => {
    // The tape: up 1e-18 over down 1e308 — (1e-18 × 100) / 1e308 rounds below the smallest double
    // to 0; the next window reads 50 / 1e308 = 5e-307 and the signal averages the two.
    const tape = [traded(0, 10, 1), traded(1, 11, 1e-18), traded(2, 10, 1e308), traded(3, 10, 1)];
    const out = vr(sourceOf(tape), { period: 2, signal: 2 }).out;
    const values = ys(out.vr.read());
    expect(values[2]).toBe(0);
    expect(Math.abs((values[3] ?? Number.NaN) / 5e-307 - 1)).toBeLessThan(1e-12);
    expect(Math.abs((ys(out.signal.read())[3] ?? Number.NaN) / 2.5e-307 - 1)).toBeLessThan(1e-12);
  });

  it("the scaled fallback keeps a finite side's cancellation — a negative up-volume against a huge down", () => {
    // The window: up −4.0988030753420573e307, down 1.4873746372346521e308, flat 8.197606150684114e307 over 3 bars.
    // down + flat/2 overflows (so the fallback runs), while up + flat/2 = −4.9896e291 is finite and exact-ish;
    // scaling the two numerator terms separately before adding would cancel it to 0.
    const up = -4.0988030753420573e307, down = 1.4873746372346521e308, flat = 8.197606150684114e307;
    const tape = [traded(0, 10, 100), traded(1, 11, up), traded(2, 10, down), traded(3, 10, flat)];
    const out = ys(vr(sourceOf(tape), { period: 3, signal: 1 }).out.vr.read());
    const want = ((up + flat / 2) * 100) / (down / 2 + flat / 4) / 2; // both sides halved — the ratio is scale-free
    expect(Math.abs((out[3] ?? Number.NaN) / want - 1)).toBeLessThan(1e-9);
  });

  it("negative volumes — which the core does not refuse — still form the documented ratio", () => {
    const tape = [traded(0, 10, 100), traded(1, 11, -2), traded(2, 10, -1)];
    expect(ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read())[2]).toBe(200);
  });

  it("a ratio that leaves the double range is no reading — null, not Infinity", () => {
    // up 1e308 over down 1e-308: every window sum is finite, the ratio is not.
    const tape = [traded(0, 10, 100), traded(1, 11, 1e308), traded(2, 10, 1e-308)];
    const out = ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read());
    expect(out[2]).toBeNull();
  });

  it("is null while nothing moved down and nothing was flat — no denominator", () => {
    const tape = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 12, 300)];
    expect(ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read())).toEqual([null, null, null]);
  });

  it("a zero-volume bar is a real bar — it contributes 0 to every sum and does not null the window", () => {
    // closes 10,11,12,13 · volumes 100,200,0,300 · period 2 at i=3: [i2, i3] up 0 + 300, no down/flat → denominator 0 → null;
    // at i=2: [i1, i2] up 200 + 0 → null too (no denominator). Make i3 a down bar instead so the ratio exists.
    const tape = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 12, 0), traded(3, 11, 300)];
    const out = ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read());
    // [i2, i3]: up 0 (the zero-volume up bar), down 300 → 0/300 = 0 — a reading, not a gap.
    expect(out[3]).toBe(0);
  });

  it("a bar without volume nulls every window that holds it, and the value comes back", () => {
    const tape = [traded(0, 10, 100), traded(1, 9, 200), traded(2, 11, null), traded(3, 10, 300), traded(4, 12, 400), traded(5, 11, 500)];
    const out = ys(vr(sourceOf(tape), { period: 2, signal: 1 }).out.vr.read());
    // i1's window reaches the first bar (no previous close); i2 is the gap; i3's window holds it.
    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    // [i3, i4]: down 300, up 400 → 133.3; [i4, i5]: up 400, down 500 → 80.
    expectClose(out.slice(4), [(400 / 300) * 100, (400 / 500) * 100], "vr");
  });

  it("matches the formula written out over a tape, within a tolerance — with the project's first-bar policy (null, not flat against itself); the signal against the package's own sma kernel", () => {
    const c = closes(80);
    const vol = c.map((_, i) => 1000 + (i % 7) * 50);
    const tape = c.map((v, i) => traded(i, v, vol[i]));
    const n = 26;
    const up = c.map((v, i) => (i === 0 ? null : v > c[i - 1] ? vol[i] : 0));
    const down = c.map((v, i) => (i === 0 ? null : v < c[i - 1] ? vol[i] : 0));
    const flat = c.map((v, i) => (i === 0 ? null : v === c[i - 1] ? vol[i] : 0));
    const win = (a: (number | null)[], i: number) => {
      if (i < n) return null; // the first bar is null, so the first full window ends at n
      const w = a.slice(i - n + 1, i + 1);
      return w.every((x) => x !== null) ? w.reduce<number>((t, x) => t + (x ?? 0), 0) : null;
    };
    const want = c.map((_, i) => {
      const u = win(up, i), d = win(down, i), f = win(flat, i);
      if (u === null || d === null || f === null) return null;
      const den = d + f / 2;
      return den === 0 ? null : ((u + f / 2) / den) * 100;
    });
    const node = vr(sourceOf(tape), {});
    expectClose(ys(node.out.vr.read()), want, "vr");
    expectClose(ys(node.out.signal.read()), sma(want, 6), "signal");
  });

  it("reads exactly what its stated order gives — `((up + flat/2) × 100) / (down + flat/2)`; the signal against the package's own sma kernel", () => {
    // The canonical divides first, then multiplies by 100; on this tape the two orders first part at
    // bar 28, by one ulp (1.4e-14 on 101.94). The exact oracle is the stated order; the tolerance above
    // is parity.
    const c = closes(80);
    const tape = c.map((v, i) => traded(i, v, 1e6 + (i % 5) * 1e5));
    const n = 26;
    const side = (pick: (close: number, previous: number, volume: number) => number) =>
      c.map((v, i) => (i === 0 ? null : pick(v, c[i - 1], 1e6 + (i % 5) * 1e5)));
    const up = side((v, p, vol) => (v > p ? vol : 0)), down = side((v, p, vol) => (v < p ? vol : 0)), flat = side((v, p, vol) => (v === p ? vol : 0));
    const win = (a: (number | null)[], i: number) => {
      if (i < n) return null;
      const w = a.slice(i - n + 1, i + 1);
      return w.every((x) => x !== null) ? w.reduce<number>((t, x) => t + (x ?? 0), 0) : null;
    };
    const stated = c.map((_, i) => {
      const u = win(up, i), d = win(down, i), f = win(flat, i);
      if (u === null || d === null || f === null) return null;
      const halfFlat = f / 2;
      const numerator = u + halfFlat;
      const denominator = d + halfFlat;
      return d === 0 && f === 0 ? null : (numerator * 100) / denominator;
    });
    const node = vr(sourceOf(tape), {});
    expect(ys(node.out.vr.read())).toEqual(stated);
    expect(ys(node.out.signal.read())).toEqual(sma(stated, 6));
  });
});

describe("emv", () => {
  // open and close sit at the midpoint, formed as low/2 + high/2 so a bar near the double limit stays a valid candle.
  const ohlcv = (i: number, high: number, low: number, volume: number | null): OHLC => ({ x: i * 60, open: low / 2 + high / 2, high, low, close: low / 2 + high / 2, volume });

  it("is the midpoint move scaled by range over volume — by hand, with the signal as its sma", () => {
    // hl2 10 → 12: dm 2, range 4, volume 2e8 → 2 × 4 × 1e8 / 2e8 = 4; then hl2 12 → 11: dm −1, range 2, volume 1e8 → −2
    const tape = [ohlcv(0, 11, 9, 1e8), ohlcv(1, 14, 10, 2e8), ohlcv(2, 12, 10, 1e8)];
    const node = emv(sourceOf(tape), { period: 2 });
    expectClose(ys(node.out.emv.read()), [null, 4, -2], "emv");
    expectClose(ys(node.out.signal.read()), [null, null, 1], "signal");
  });

  it("divides by the volume first — an extreme but finite bar keeps a finite reading", () => {
    // distance 1e154, range 1e154, volume 1e308: multiplying first overflows; dividing by the volume first gives 1e8.
    const tape = [ohlcv(0, 1e154, 0, 1e8), ohlcv(1, 2e154, 1e154, 1e308)];
    const out = ys(emv(sourceOf(tape), { period: 1 }).out.emv.read());
    expect(out[1]).not.toBeNull();
    expect(Math.abs((out[1] ?? Number.NaN) / 1e8 - 1)).toBeLessThan(1e-9);
  });

  it("takes the midpoint without adding the extremes — highs near the double limit still read", () => {
    // high + low would overflow (2e308); low + range/2 does not. Both bars sit just under the limit with a range of 1e300;
    // the midpoint moves by 1e300, so with volume 1e308 the reading is (1e300 / 1e308) × 1e300 × 1e8 = 1e300 — finite.
    const top = 1e308;
    const tape = [ohlcv(0, top - 1e300, top - 2e300, 1e8), ohlcv(1, top, top - 1e300, 1e308)];
    const out = ys(emv(sourceOf(tape), { period: 1 }).out.emv.read());
    expect(out[1]).not.toBeNull();
    expect(Math.abs((out[1] ?? Number.NaN) / 1e300 - 1)).toBeLessThan(1e-6);
  });

  it("a tiny move over a huge volume keeps its digits — the order of operations must not flush it to 0", () => {
    // The low drops by one ulp of 0.5 (2^-53): the midpoint moves −2^-54, exactly representable at the operands'
    // scale. Over volume 1e308 with range 1 the reading is −2^-54 × 1e-300 ≈ −5.6e-317 — a subnormal, but a
    // number; dividing the distance by the volume first would flush it below the smallest double to 0.
    const step = 2 ** -53;
    const tape = [ohlcv(0, 1.5, 0.5, 1e8), ohlcv(1, 1.5, 0.5 - step, 1e308)];
    const out = ys(emv(sourceOf(tape), { period: 1 }).out.emv.read());
    const want = (-step / 2) * (((1 + step) / 1e308) * 1e8); // grouped so the expectation itself does not underflow
    expect(out[1]).not.toBe(0);
    expect(Math.abs((out[1] ?? Number.NaN) / want - 1)).toBeLessThan(1e-6);
  });

  it("a half-ulp move of the midpoint is still a move — the distance is taken from the differences", () => {
    // Separately rounded midpoints both land on 1.0000000000000004 and would read 0; the true move is −1.11e-16.
    const tape = [ohlcv(0, 1.0000000000000009, 1, 1e8), ohlcv(1, 1.0000000000000007, 1, 1)];
    const out = ys(emv(sourceOf(tape), { period: 1 }).out.emv.read());
    const distance = ((1.0000000000000007 - 1.0000000000000009) + (1 - 1)) / 2;
    const want = distance * ((1.0000000000000007 - 1) / 1) * 1e8;
    expect(out[1]).not.toBe(0);
    expect(Math.abs((out[1] ?? Number.NaN) / want - 1)).toBeLessThan(1e-9);
  });

  it("gradual underflow is rounding, not a gap — a halved move, a range over volume or the product that rounds to 0 reads 0", () => {
    // Δhigh + Δlow = MIN_VALUE, halved to 0: the bar reads 0 (exact ≈ 4.9e-316).
    const halved = [ohlcv(0, Number.MIN_VALUE, 0, 1e8), ohlcv(1, 2 * Number.MIN_VALUE, 0, Number.MIN_VALUE)];
    expect(ys(emv(sourceOf(halved), { period: 1 }).out.emv.read())[1]).toBe(0);
    // range 1e-308 over volume 1e308 rounds to 0 while the move is huge: 0.
    const perVolume = [ohlcv(0, -1e300 + 1, -1e300 - 1, 1e8), ohlcv(1, 1e-308, 0, 1e308)];
    expect(ys(emv(sourceOf(perVolume), { period: 1 }).out.emv.read())[1]).toBe(0);
    // The tape: distance MIN_VALUE times (range / volume) × 1e8 = 1e-8 rounds to 0, and the signal
    // window averages that 0 with the next bar's reading — a reading, not a poisoned state.
    const product = [ohlcv(0, 0, -1, 1e8), ohlcv(1, 2 * Number.MIN_VALUE, -1, 1e16), ohlcv(2, 3, 0, 1)];
    const out = emv(sourceOf(product), { period: 2 }).out;
    expect(ys(out.emv.read())[1]).toBe(0);
    expect(ys(out.signal.read())[2]).toBe((ys(out.emv.read())[2] ?? Number.NaN) / 2);
  });

  it("a zero-volume bar and a zero-range bar are undefined — the box ratio has no value — null, not 0 and not Infinity", () => {
    const tape = [ohlcv(0, 11, 9, 1e8), ohlcv(1, 14, 10, 0), ohlcv(2, 12, 12, 1e8), ohlcv(3, 13, 11, 1e8)];
    // i3: hl2 12 against i2's 12 — a move of 0 is a reading of 0, not a gap.
    expect(ys(emv(sourceOf(tape), { period: 1 }).out.emv.read())).toEqual([null, null, null, 0]);
  });

  it("matches the canonical formula written out (its 0 for undefined bars → null) over a tape, within a tolerance — the signal against the package's own sma kernel", () => {
    const c = closes(80);
    const tape = c.map((v, i) => ohlcv(i, v + 1 + (i % 3) * 0.4, v - 1 - (i % 5) * 0.3, 1e8 + (i % 7) * 1e7));
    const want = tape.map((b, i) => {
      if (i === 0) return null;
      const p = tape[i - 1];
      const dm = (b.high + b.low) / 2 - (p.high + p.low) / 2;
      const volume = b.volume ?? 0;
      return volume === 0 || b.high - b.low === 0 ? null : dm / (volume / 100000000 / (b.high - b.low));
    });
    const node = emv(sourceOf(tape), {});
    expectClose(ys(node.out.emv.read()), want, "emv");
    expectClose(ys(node.out.signal.read()), sma(want, 14), "signal");
  });

  it("reads exactly what its stated order gives — the extremes' moves halved, times range over volume times 1e8; the signal against the package's own sma kernel", () => {
    // The canonical rounds two midpoints and divides the other way round; on this tape the orders part at
    // bar 1 by 20 ulp (1.8e-14 on 5.6) and near 0.09 at bar 8 by 1722 ulp — the midpoints' rounding
    // cancels in the canonical's subtraction. The exact oracle is the stated order; the tolerance above
    // is parity.
    const c = closes(80);
    const tape = c.map((v, i) => ohlcv(i, v + 1 + (i % 3) * 0.4, v - 1 - (i % 5) * 0.3, 1e8 + (i % 7) * 1e7));
    const stated = tape.map((b, i) => {
      if (i === 0) return null;
      const p = tape[i - 1];
      const volume = b.volume ?? 0;
      const range = b.high - b.low;
      if (volume === 0 || range === 0) return null;
      const distance = (b.high - p.high + (b.low - p.low)) / 2;
      return distance * ((range / volume) * 100000000);
    });
    const node = emv(sourceOf(tape), {});
    expect(ys(node.out.emv.read())).toEqual(stated);
    expect(ys(node.out.signal.read())).toEqual(sma(stated, 14));
  });
});

describe("cr", () => {
  const ohlc = (i: number, high: number, low: number): OHLC => ({ x: i * 60, open: low / 2 + high / 2, high, low, close: low / 2 + high / 2, volume: 1000 });
  /** The literature's displacement, `M / 2.5 + 1` rounded up — written out here so the test does not borrow it from the code. */
  const crDisplacement = (period: number) => Math.ceil(period / 2.5 + 1);

  it("sums the pressure above and below the previous midpoint over the window — by hand", () => {
    // mids 10, 11, 11: bar1 above 3 (13 − 10), below 1 (10 − 9) → 300; bar2 above 1, below 1 → 100;
    // bar3 above 3 (14 − 11), below max(0, 11 − 12) = 0 → over one bar there is no ratio.
    const tape = [ohlc(0, 12, 8), ohlc(1, 13, 9), ohlc(2, 12, 10), ohlc(3, 14, 12)];
    expect(ys(cr(sourceOf(tape), { period: 1, periods: [1, 1, 1, 1] }).out.cr.read())).toEqual([null, 300, 100, null]);
    // Over two bars the window sums carry the day: bar3 reads (1 + 3) / (1 + 0) × 100 = 400 — a bar-by-bar ratio
    // under this package's null rule would be null here and empty every average window that holds the bar (the
    // canonical's code writes 0 for the bar and averages that 0).
    expect(ys(cr(sourceOf(tape), { period: 2, periods: [1, 1, 1, 1] }).out.cr.read())).toEqual([null, null, 200, 400]);
  });

  it("draws each average ceil(p / 2.5 + 1) bars back — the value that stood that many bars earlier", () => {
    expect([10, 20, 40, 60].map(crDisplacement)).toEqual([5, 9, 17, 25]);
    // With one-bar averages the average is the CR itself, so ma1 at bar 3 is the CR of bar 1 (displacement 2).
    const tape = [ohlc(0, 12, 8), ohlc(1, 13, 9), ohlc(2, 12, 10), ohlc(3, 14, 12)];
    const out = cr(sourceOf(tape), { period: 1, periods: [1, 1, 1, 1] }).out;
    expect(ys(out.ma1.read())).toEqual([null, null, null, 300]);
  });

  it("reads exactly what its stated order gives over a tape — window sums written out; the averages are the package's own sma kernel, displaced by index", () => {
    const c = closes(200);
    const tape = c.map((v, i) => ohlc(i, v + 1 + (i % 3) * 0.4, v - 1 - (i % 5) * 0.3));
    const n = 26, periods = [10, 20, 40, 60] as const;
    const above = tape.map((b, i) => (i === 0 ? null : Math.max(0, b.high - (tape[i - 1].high / 2 + tape[i - 1].low / 2))));
    const below = tape.map((b, i) => (i === 0 ? null : Math.max(0, tape[i - 1].high / 2 + tape[i - 1].low / 2 - b.low)));
    const win = (a: (number | null)[], i: number) => {
      if (i < n) return null;
      const w = a.slice(i - n + 1, i + 1);
      return w.every((x) => x !== null) ? w.reduce<number>((t, x) => t + (x ?? 0), 0) : null;
    };
    const stated = c.map((_, i) => {
      const a = win(above, i), b = win(below, i);
      return a === null || b === null || b === 0 ? null : (a / b) * 100;
    });
    const displaced = (period: number) => {
      const mean = sma(stated, period);
      const shift = crDisplacement(period);
      return mean.map((_, i) => (i < shift ? null : mean[i - shift]));
    };
    const out = cr(sourceOf(tape), {}).out;
    expect(ys(out.cr.read())).toEqual(stated);
    expect(ys(out.ma1.read())).toEqual(displaced(periods[0]));
    expect(ys(out.ma2.read())).toEqual(displaced(periods[1]));
    expect(ys(out.ma3.read())).toEqual(displaced(periods[2]));
    expect(ys(out.ma4.read())).toEqual(displaced(periods[3]));
    // With the defaults the CR reads from the 27th bar (index 26), MA(60) from the 111th (index 110): 110
    // bars of memory before the first reading — the declared lookback, which the landing table holds.
    expect(ys(out.cr.read()).findIndex((v) => v !== null)).toBe(26);
    expect(ys(out.ma4.read()).findIndex((v) => v !== null)).toBe(110);
  });

  it("a ratio that leaves the range, or lands on the largest double, is no reading and no average — and the next bar recovers", () => {
    // Over one bar, each bar against the previous midpoint:
    //   bar1 — mid 10: above 1e308, below 1 → ×100 overflows → no reading (left the range);
    //   bar2 — mid 5e307: above 0, below huge → 0, a reading;
    //   bar3 — mid 10 (bar2 is 12/8): above 0, below 0 → the undefined case;
    //   bar4 — mid 10: above MAX/100 (10 + MAX/100 is MAX/100 exactly), below 1 → ×100 lands exactly on the
    //          largest double → no reading (saturated);
    //   bar5 — mid ≈ MAX/200: 0; bar6 — mid 10: above 3, below 1 → 300.
    // Each rejected bar is null on the band and, through the observation door, in every average window that holds it.
    const top = Number.MAX_VALUE;
    const tape = [ohlc(0, 10, 10), ohlc(1, 1e308, 9), ohlc(2, 12, 8), ohlc(3, 10, 10), ohlc(4, 10 + top / 100, 9), ohlc(5, 12, 8), ohlc(6, 13, 9)];
    const out = cr(sourceOf(tape), { period: 1, periods: [1, 1, 1, 1] }).out;
    const band = ys(out.cr.read());
    expect(band).toEqual([null, null, 0, null, null, 0, 300]);
    // ma1 is the band displaced by 2 bars.
    expect(ys(out.ma1.read())).toEqual([null, null, ...band.slice(0, 5)]);
  });

  it("refuses anything but four average windows, like bbi", () => {
    const tape = [ohlc(0, 12, 8), ohlc(1, 13, 9)];
    const two: unknown = [10, 20];
    expect(() => cr(sourceOf(tape), { periods: two as never })).toThrow(ContractError);
    expect(() => cr(sourceOf(tape), { periods: two as never })).toThrow(/^cr\(\{ periods \}\) must be exactly four windows/);
  });
});

describe("kdj", () => {
  const ohlc = (i: number, high: number, low: number, close: number): OHLC => ({ x: i * 60, open: close, high, low, close, volume: 1000 });

  it("starts K and D at 50 and applies the recurrence from the first RSV — the canonical's first values", () => {
    // Window 1: rsv = (close − low) / (high − low) × 100. bar0: (8 − 0)/10 → 80 → K (100 + 80)/3 = 60, D (100 + 60)/3 = 53.3…, J 3·60 − 2·53.3….
    const tape = [ohlc(0, 10, 0, 8), ohlc(1, 10, 0, 2)];
    const out = kdj(sourceOf(tape), { period: 1, smooth: 3, signal: 3 }).out;
    const k0 = (50 * 2 + 80) / 3, d0 = (50 * 2 + k0) / 3;
    const k1 = (k0 * 2 + 20) / 3, d1 = (d0 * 2 + k1) / 3;
    expect(ys(out.k.read())).toEqual([k0, k1]);
    expect(ys(out.d.read())).toEqual([d0, d1]);
    expect(ys(out.j.read())).toEqual([3 * k0 - 2 * d0, 3 * k1 - 2 * d1]);
  });

  it("a flat window is undefined — null, the recursions keep their state and resume", () => {
    // bar1's window (period 1) has high = low: rsv is null; K stays at k0 and bar2 continues from it.
    const tape = [ohlc(0, 10, 0, 8), ohlc(1, 5, 5, 5), ohlc(2, 10, 0, 5)];
    const out = kdj(sourceOf(tape), { period: 1, smooth: 3, signal: 3 }).out;
    const k0 = (50 * 2 + 80) / 3, d0 = (50 * 2 + k0) / 3;
    const k2 = (k0 * 2 + 50) / 3, d2 = (d0 * 2 + k2) / 3;
    expect(ys(out.k.read())).toEqual([k0, null, k2]);
    expect(ys(out.d.read())).toEqual([d0, null, d2]);
    expect(ys(out.j.read())).toEqual([3 * k0 - 2 * d0, null, 3 * k2 - 2 * d2]);
  });

  it("reads exactly what its stated order gives over a tape — the canonical's arithmetic with its flat windows null", () => {
    const c = closes(120);
    const tape = c.map((v, i) => ohlc(i, v + 1 + (i % 3) * 0.4, v - 1 - (i % 5) * 0.3, v));
    const n = 9, smooth = 3, signal = 3;
    let k: number = 50, d: number = 50;
    const want = { k: [] as (number | null)[], d: [] as (number | null)[], j: [] as (number | null)[] };
    tape.forEach((b, i) => {
      if (i < n - 1) {
        want.k.push(null); want.d.push(null); want.j.push(null);
        return;
      }
      const window = tape.slice(i - n + 1, i + 1);
      const hn = Math.max(...window.map((x) => x.high)), ln = Math.min(...window.map((x) => x.low));
      if (hn === ln) {
        want.k.push(null); want.d.push(null); want.j.push(null);
        return;
      }
      const rsv = ((b.close / 2 - ln / 2) / (hn / 2 - ln / 2)) * 100;
      k = (k * (smooth - 1) + rsv) / smooth;
      d = (d * (signal - 1) + k) / signal;
      want.k.push(k); want.d.push(d); want.j.push(3 * k - 2 * d);
    });
    const out = kdj(sourceOf(tape), {}).out;
    expect(ys(out.k.read())).toEqual(want.k);
    expect(ys(out.d.read())).toEqual(want.d);
    expect(ys(out.j.read())).toEqual(want.j);
    // On ordinary magnitudes the halves and the full differences give the same double, bit for bit.
    tape.forEach((b, i) => {
      if (i < n - 1) return;
      const window = tape.slice(i - n + 1, i + 1);
      const hn = Math.max(...window.map((x) => x.high)), ln = Math.min(...window.map((x) => x.low));
      if (hn === ln) return;
      expect(((b.close / 2 - ln / 2) / (hn / 2 - ln / 2)) * 100).toBe(((b.close - ln) / (hn - ln)) * 100);
    });
    // J leaves 0–100 on ordinary data — the reason its pane is not fixed to it.
    expect(want.j.some((v) => v !== null && (v < 0 || v > 100))).toBe(true);
  });

  it("lands a page by recomputing everything — a prepend alone, before any tick, equals a cold node across a long flat stretch", () => {
    // The recursions' memory is counted in observations. 160 flat bars (high = low) make the nine-bar window flat
    // from the ninth on — 152 bars (228–379) with no observation, holding K and D — so any bar-counted door (146 =
    // 8 + 69 + 69, say) would keep a tail whose state came from the old origin (seed 50, twenty observations on —
    // bars 208 to 227) rather than the cold node's; only a tick-less read can tell.
    const shape = (i: number, level: number, flat: boolean): OHLC =>
      flat ? ohlc(i, level, level, level) : ohlc(i, level + 1 + (i % 3) * 0.4, level - 1 - (i % 5) * 0.3, level);
    // The stretch sits at one level — the window's high equals its low from its ninth bar on.
    const live = (i: number) => (i >= 220 && i < 380 ? shape(i, 100, true) : shape(i, 100 + Math.sin(i / 4) * 7, false));
    let data = Array.from({ length: 300 }, (_, i) => live(i + 200));
    const node = kdj({ read: () => data }, {});
    for (const key of ["k", "d", "j"] as const) node.out[key].read();
    data = [...Array.from({ length: 200 }, (_, i) => shape(i, 90 + Math.cos(i / 5) * 4, false)), ...data];
    const cold = kdj(sourceOf(data), {}).out;
    for (const key of ["k", "d", "j"] as const) expectClose(ys(node.out[key].read()), ys(cold[key].read()), `kdj ${key} after a landing`);
  });

  it("a window spanning more than half the double range still reads — the halves do not overflow where the differences would", () => {
    // high 1e308, low −1e308, close 0: (close − low) / (high − low) would be 1e308 / Infinity = a wrong finite 0;
    // the halves read (5e307) / (1e308) × 100 = 50, and K moves to (100 + 50) / 3.
    const tape = [ohlc(0, 10, 0, 8), ohlc(1, 1e308, -1e308, 0)];
    const out = kdj(sourceOf(tape), { period: 1, smooth: 3, signal: 3 }).out;
    const k0 = (50 * 2 + 80) / 3;
    expect(ys(out.k.read())).toEqual([k0, (k0 * 2 + 50) / 3]);
  });

  it("an RSV that leaves the range is no reading and no state — the next ordinary bar continues from the kept state", () => {
    // Window 1 with a range of exactly MIN_VALUE (high MIN_VALUE, low 0 — 1 + MIN_VALUE would round back to 1 and
    // read as a flat window instead) and a close far above its high (not a well-formed candle — the point is the
    // arithmetic): the halved range MIN_VALUE / 2 rounds to 0, so the ratio is 5e299 / 0 = Infinity — no observation.
    const tape = [ohlc(0, 10, 0, 8), ohlc(1, Number.MIN_VALUE, 0, 1e300), ohlc(2, 10, 0, 2)];
    const out = kdj(sourceOf(tape), { period: 1, smooth: 3, signal: 3 }).out;
    const k0 = (50 * 2 + 80) / 3;
    expect(ys(out.k.read())).toEqual([k0, null, (k0 * 2 + 20) / 3]);
  });
});

describe("pvt", () => {
  const traded = (i: number, close: number, volume: number | null) => bar(i, close, volume);

  it("accumulates the percent change times volume, starting at 0 — by hand", () => {
    // 10 → 11: +10% × 200 = 20; 11 → 11: 0; 11 → 10: −1/11 × 400
    const tape = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 11, 300), traded(3, 10, 400)];
    expectClose(ys(pvt(sourceOf(tape)).out.pvt.read()), [0, 20, 20, 20 - 400 / 11], "pvt");
  });

  it("a bar without volume is null and the sum resumes on the next bar — like obv", () => {
    const tape = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 12, null), traded(3, 15, 100)];
    // i3 moves against i2's close (12 → 15 = +25% × 100 = 25) on top of 20.
    expectClose(ys(pvt(sourceOf(tape)).out.pvt.read()), [0, 20, null, 45], "pvt");
  });

  it("keeps its sum exact across a long cancelling tape — the running total is compensated", () => {
    // Contributions 1e16, −1, 2, −1e16 repeated: a naive sum drops the small terms and reads 2; the exact total is 25 000.
    // close 1 → 2 (+100%) × 1e16 · 2 → 1 (−50%) × 2 · 1 → 2 × 2 · 2 → 1 × 2e16, i.e. +1e16, −1, +2, −1e16.
    const cycle = [
      [2, 1e16],
      [1, 2],
      [2, 2],
      [1, 2e16],
    ];
    const tape: OHLC[] = [traded(0, 1, 1)];
    for (let k = 0; k < 25_000; k++) for (const [close, volume] of cycle) tape.push(traded(tape.length, close, volume));
    const out = pvt(sourceOf(tape)).out.pvt.read();
    expect(out[out.length - 1].y).toBe(25_000);
  });

  it("a contribution that rounds to 0 is a zero contribution — the total repeats, as rounding", () => {
    // The tape: close 2 → 2 + 2⁻⁵¹ on volume Number.MIN_VALUE — a change of 2⁻⁵² times the smallest
    // double rounds to 0. The total stands at 1, a reading, not a gap.
    const tape = [traded(0, 1, 1), traded(1, 2, 1), traded(2, 2 + 2 ** -51, Number.MIN_VALUE)];
    expect(ys(pvt(sourceOf(tape)).out.pvt.read())).toEqual([0, 1, 1]);
  });

  it("a contribution that leaves the double range is no reading and leaves the sum intact", () => {
    // 1e-308 → 1 is a change of 1e308 ×; times volume 1e308 the term is Infinity. That bar is null and the next resumes.
    const tape = [traded(0, 1, 100), traded(1, 1e-308, 100), traded(2, 1, 1e308), traded(3, 2, 100)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out[2]).toBeNull();
    // i1: (1e-308 − 1)/1 × 100 ≈ −100; i3: (2 − 1)/1 × 100 = 100 on top of it.
    expectClose([out[0], out[1], out[3]], [0, -100, 0], "pvt");
  });

  it("an unrepresentable sum is not committed — the sum stays where it was and later bars can bring it back", () => {
    // +1e308 (1 → 2 on volume 1e308), then +1e308 again (2 → 4) would overflow: that bar is null, the sum stays 1e308;
    // then 4 → 0 (−100%) on volume 1e308 contributes −1e308 and the sum reads 0.
    const tape = [traded(0, 1, 100), traded(1, 2, 1e308), traded(2, 4, 1e308), traded(3, 0, 1e308)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out[1]).toBe(1e308);
    expect(out[2]).toBeNull();
    expect(out[3]).toBe(0);
  });

  it("a contribution at the largest double is refused before any sum is formed", () => {
    // A contribution of MAX_VALUE is not committable — it is refused before the sum is touched (the sum
    // that saturates from a committable term is the next test). That bar is null, the state stays at 0,
    // and the next ordinary bar (+50% × 100) reads 50 on top of the untouched sum.
    const tape = [traded(0, 1, 100), traded(1, 2, Number.MAX_VALUE), traded(2, 3, 100)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out).toEqual([0, null, 50]);
  });

  it("a contribution that lands on the largest double is no reading even when the sum would absorb it", () => {
    // 1 → 0.25 on volume 1.333e308 contributes −1e308; then 0.25 → 0.5 (+100%) on volume MAX_VALUE contributes
    // exactly MAX_VALUE — a saturated number, not a contribution — so that bar is null and the sum stays −1e308.
    const tape = [traded(0, 1, 100), traded(1, 0.25, 1.3333333333333333e308), traded(2, 0.5, Number.MAX_VALUE), traded(3, 0.5, 100)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out[2]).toBeNull();
    expectClose([out[1], out[3]], [-1e308, -1e308], "pvt");
  });

  it("a sum that lands exactly on the largest double is not committed — the term was fine, the sum is not", () => {
    // total A = MAX − ulp, then a contribution of exactly one ulp: next = MAX_VALUE, finite but saturated.
    const A = 1.7976931348623155e308;
    const ulp = 2 ** 971;
    const tape = [traded(0, 1, 100), traded(1, 2, A), traded(2, 4, ulp), traded(3, 4, 100)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out[1]).toBe(A);
    expect(out[2]).toBeNull();
    expect(out[3]).toBe(A);
  });

  it("a compensated sum that lands on the largest double is not committed either", () => {
    // The sequence: contributions A, t, t with A = MAX − 2·ulp-ish and t chosen so total + compensation
    // becomes exactly MAX_VALUE while total and compensation each stay finite.
    const A = 1.7976931348623155e308;
    const t = 5.987520928604159e291;
    // bars: 1 → 2 on volume A (+A); 2 → 1 on volume −2t (−50% × −2t = +t); 1 → 2 on volume t (+t)
    // then an unchanged close (contribution 0) reads the sum as it stood before the rejected bar: A + t → A.
    const tape = [traded(0, 1, 100), traded(1, 2, A), traded(2, 1, -2 * t), traded(3, 2, t), traded(4, 2, 100)];
    const out = ys(pvt(sourceOf(tape)).out.pvt.read());
    expect(out[1]).toBe(A);
    expect(out[2]).not.toBeNull();
    expect(out[3]).toBeNull();
    expect(out[4]).toBe(A);
  });

  it("resumes its ticks across a volume gap exactly — replace and append after the gap equal a cold node", () => {
    const base = [traded(0, 10, 100), traded(1, 11, 200), traded(2, 12, null), traded(3, 13, 300)];
    for (const make of [
      (s: Source<OHLC>) => pvt(s).out.pvt,
      (s: Source<OHLC>) => vr(s, { period: 2, signal: 1 }).out.vr,
      (s: Source<OHLC>) => emv(s, { period: 2 }).out.emv,
    ]) {
      let data = base;
      const live = make({ read: () => data });
      live.read();
      data = [...base.slice(0, 3), traded(3, 9, 500)]; // replace the bar after the gap
      expectClose(ys(live.read()), ys(make(sourceOf(data)).read()), "replace after a gap");
      data = [...data, traded(4, 14, null), traded(5, 15, 700)]; // append a gap, then a bar after it
      live.read();
      expectClose(ys(live.read()), ys(make(sourceOf(data)).read()), "append after a gap");
    }
  });

  it("lands a page by recomputing everything — a prepend alone, before any tick, equals a cold node", () => {
    // A running sum has no bounded lookback. Were a head door declared, the kept tail would carry the
    // old origin's level; the first tick would then repair it (ADR-0050), so only a tick-less read can tell.
    let data = closes(300).map((v, i) => traded(i + 200, v, 1000 + (i % 7) * 50));
    const live = pvt({ read: () => data });
    live.out.pvt.read();
    data = [...closes(200).map((v, i) => traded(i, v + 5, 900 + (i % 5) * 30)), ...data];
    const cold = pvt(sourceOf(data)).out.pvt.read();
    expectClose(ys(live.out.pvt.read()), ys(cold), "pvt after a landing");
  });

  it("the first bar is 0 only when it has volume; a previous close of 0 is no reading", () => {
    expect(ys(pvt(sourceOf([traded(0, 10, null), traded(1, 11, 100)])).out.pvt.read())).toEqual([null, 10]);
    expect(ys(pvt(sourceOf([traded(0, 0, 100), traded(1, 5, 100), traded(2, 10, 100)])).out.pvt.read())).toEqual([0, null, 100]);
  });
});
