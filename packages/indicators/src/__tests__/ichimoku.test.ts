/**
 * Ichimoku's two doors:
 *
 * - `ahead` — the x of the bar `steps` after the last one. Given, the leading
 *   spans and the cloud run `displacement` bars past the last candle. Absent,
 *   they stop at it — the x of a bar that does not exist yet is the feed's
 *   to say, not this package's.
 * - `calcFirst` — a history page corrects only a finite prefix; the rest of
 *   the output, projection included, keeps its objects. The lagging span
 *   reads *ahead* by `displacement`, so the prefix is computed on
 *   `displacement` more inputs than it re-emits.
 */
import type { OHLC, Source } from "@finchart/core";
import { barIndexX, candleSeries, ContractError, createPlotModel } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { bandSeries } from "../band-series";
import { ichimoku } from "../factories";
import { attachIchimoku } from "../plugins";

const bar = (i: number): OHLC => {
  const v = 100 + Math.sin(i / 5) * 8 + (i % 3);
  return { x: i * 60_000, open: v, high: v + 1 + (i % 2), low: v - 1 - (i % 4) * 0.25, close: v + 0.3 };
};
const bars = (from: number, to: number): OHLC[] => Array.from({ length: to - from }, (_, k) => bar(from + k));
const minute = (lastX: number, steps: number) => lastX + steps * 60_000;

function feed(initial: OHLC[]) {
  let data = initial;
  const source: Source<OHLC> = { read: () => data };
  return {
    source,
    prepend: (older: OHLC[]) => {
      data = [...older, ...data];
    },
    append: (next: OHLC[]) => {
      data = [...data, ...next];
    },
    replaceLast: (next: OHLC) => {
      data = [...data.slice(0, -1), next];
    },
  };
}

describe("ichimoku — ahead", () => {
  it("projects the leading spans and the cloud displacement bars past the last candle", () => {
    const data = bars(0, 80);
    const node = ichimoku({ read: () => data }, { ahead: minute });
    const plain = ichimoku({ read: () => data });
    const spanA = node.out.spanA.read();
    const spanB = node.out.spanB.read();
    const cloud = node.out.cloud.read();
    expect(spanA).toHaveLength(80 + 26);
    expect(spanB).toHaveLength(80 + 26);
    expect(cloud).toHaveLength(80 + 26);
    // The first 80 are what the plain node says; the 26 after carry the raw spans forward at the feed's x.
    expect(spanA.slice(0, 80)).toEqual(plain.out.spanA.read());
    const lastX = data[79].x;
    for (let k = 1; k <= 26; k++) {
      expect(spanA[79 + k].x).toBe(minute(lastX, k));
      expect(cloud[79 + k].x).toBe(minute(lastX, k));
    }
    // A projected value is the raw span at n − displacement + k − 1: the last one is the raw span at the last bar.
    const rawB = spanB[79 + 26].y;
    const window = data.slice(80 - 52, 80);
    const expected = (Math.max(...window.map((c) => c.high)) + Math.min(...window.map((c) => c.low))) / 2;
    expect(rawB).toBeCloseTo(expected, 9);
    // The other three branches stop at the last candle.
    expect(node.out.conversion.read()).toHaveLength(80);
    expect(node.out.base.read()).toHaveLength(80);
    expect(node.out.lagging.read()).toHaveLength(80);
  });

  it("projects nothing on an empty source or with displacement 0", () => {
    expect(ichimoku({ read: () => [] }, { ahead: minute }).out.spanA.read()).toHaveLength(0);
    const data = bars(0, 60);
    expect(ichimoku({ read: () => data }, { ahead: minute, displacement: 0 }).out.cloud.read()).toHaveLength(60);
  });

  it("maps a raw index before the first bar to null when the history is shorter than the displacement", () => {
    const data = bars(0, 10);
    const cloud = ichimoku({ read: () => data }, { ahead: minute }).out.cloud.read();
    expect(cloud).toHaveLength(36);
    // Projected k = 1 reads raw index 10 − 26 + 0 < 0 → null.
    expect(cloud[10].upper).toBeNull();
    expect(cloud[10].lower).toBeNull();
  });

  it("refuses an ahead that does not move forward, is not finite, or repeats", () => {
    const data = bars(0, 60);
    const read = (ahead: (lastX: number, steps: number) => number) => () =>
      ichimoku({ read: () => data }, { ahead }).out.spanA.read();
    expect(read(() => Number.NaN)).toThrow(ContractError);
    expect(read((lastX) => lastX)).toThrow(ContractError);
    expect(read((lastX, steps) => lastX - steps)).toThrow(ContractError);
    expect(read((lastX, steps) => lastX + Math.min(steps, 2) * 60_000)).toThrow(ContractError);
    expect(read(minute)).not.toThrow();
  });

  it("keeps the projected x on a replace tick and advances it by one bar on an append", () => {
    const f = feed(bars(0, 60));
    const node = ichimoku(f.source, { ahead: minute });
    const before = node.out.cloud.read();
    const lastProjected = before[before.length - 1].x;

    f.replaceLast({ ...bar(59), high: bar(59).high + 5 });
    const replaced = node.out.cloud.read();
    expect(replaced[replaced.length - 1].x).toBe(lastProjected);

    f.append([bar(60)]);
    const appended = node.out.cloud.read();
    expect(appended[appended.length - 1].x).toBe(lastProjected + 60_000);
  });
});

describe("ichimoku — ahead, independently", () => {
  /** The raw spans from first principles — highest/lowest over a window, no factory in the oracle. */
  const midline = (data: readonly OHLC[], end: number, period: number): number | null => {
    if (end - period + 1 < 0) return null;
    const window = data.slice(end - period + 1, end + 1);
    return (Math.max(...window.map((c) => c.high)) + Math.min(...window.map((c) => c.low))) / 2;
  };
  const rawA = (data: readonly OHLC[], i: number) => {
    const fast = midline(data, i, 9);
    const slow = midline(data, i, 26);
    return fast === null || slow === null ? null : (fast + slow) / 2;
  };
  const rawB = (data: readonly OHLC[], i: number) => midline(data, i, 52);

  it("carries every projected value from the raw span at n − displacement + k − 1", () => {
    const data = bars(0, 80);
    const node = ichimoku({ read: () => data }, { ahead: minute });
    const spanA = node.out.spanA.read();
    const spanB = node.out.spanB.read();
    const cloud = node.out.cloud.read();
    for (let k = 1; k <= 26; k++) {
      const raw = 80 - 26 + k - 1;
      const a = rawA(data, raw);
      const b = rawB(data, raw);
      expect(spanA[79 + k].y, `spanA k=${k}`).toBeCloseTo(a ?? Number.NaN, 9);
      expect(spanB[79 + k].y, `spanB k=${k}`).toBeCloseTo(b ?? Number.NaN, 9);
      expect(cloud[79 + k].upper, `cloud.upper k=${k}`).toBeCloseTo(a ?? Number.NaN, 9);
      expect(cloud[79 + k].lower, `cloud.lower k=${k}`).toBeCloseTo(b ?? Number.NaN, 9);
    }
  });

  it("moves the last projected value on a replace that changes the last raw span, and keeps its x", () => {
    const f = feed(bars(0, 80));
    const node = ichimoku(f.source, { ahead: minute });
    const before = node.out.spanB.read();
    const last = before[before.length - 1];
    f.replaceLast({ ...bar(79), high: bar(79).high + 50 });
    const after = node.out.spanB.read();
    const data = f.source.read();
    expect(after[after.length - 1].x).toBe(last.x);
    expect(after[after.length - 1].y).toBeCloseTo(rawB(data, 79) ?? Number.NaN, 9);
    expect(after[after.length - 1].y).not.toBe(last.y);
  });

  it("retries on the next read after a throwing ahead — the failure is not cached", () => {
    // The node runs once at construction to learn its keys, so an `ahead`
    // that is broken from the start throws out of the factory call itself.
    expect(() => ichimoku({ read: () => bars(0, 60) }, { ahead: () => Number.NaN })).toThrow(ContractError);

    // Broken later — on a tick — the read throws, and the next read after the
    // fix computes: the input cache only advances on success.
    let broken = false;
    const f = feed(bars(0, 60));
    const node = ichimoku(f.source, { ahead: (x, k) => (broken ? Number.NaN : minute(x, k)) });
    expect(node.out.cloud.read()).toHaveLength(60 + 26);
    broken = true;
    f.append([bar(60)]);
    expect(() => node.out.cloud.read()).toThrow(ContractError);
    broken = false;
    const after = node.out.cloud.read();
    expect(after).toHaveLength(61 + 26);
    expect(after[after.length - 1].x).toBe(minute(bar(60).x, 26));
  });

  it("follows an irregular schedule — a session-skipping ahead — and re-projects when the real bar lands elsewhere", () => {
    // Bars every minute except a weekend: `ahead` knows to skip it.
    const gap = 2 * 24 * 60 * 60_000;
    const skipping = (lastX: number, steps: number) => lastX + steps * 60_000 + (lastX % 7 === 0 ? gap : 0);
    const f = feed(bars(0, 60));
    const node = ichimoku(f.source, { ahead: skipping });
    const before = node.out.cloud.read();
    expect(before[60].x).toBe(skipping(bar(59).x, 1));
    // The feed's next bar does not land where `ahead` said — the projection follows the real bar, not the prediction.
    const actual = { ...bar(60), x: bar(59).x + 5 * 60_000 };
    f.append([actual]);
    const after = node.out.cloud.read();
    expect(after[60].x).toBe(actual.x);
    expect(after[61].x).toBe(skipping(actual.x, 1));
    const cold = ichimoku(f.source, { ahead: skipping }).out.cloud.read();
    expect(after).toEqual(cold);
  });
});

describe("ichimoku — calcFirst (a history page)", () => {
  /** The prefix's lagging span reads ahead — Codex's counterexample: periods 3, displacement 2, count 1. */
  it("lands a page with the lagging span intact — the prefix is computed on displacement more inputs", () => {
    const short = (i: number): OHLC => ({ x: i, open: i, high: i + 0.5, low: i - 0.5, close: i });
    const f = feed([1, 2, 3, 4, 5, 6].map(short));
    const node = ichimoku(f.source, { conversion: 3, base: 3, span: 3, displacement: 2 });
    node.out.lagging.read();
    f.prepend([short(0)]);
    const landed = node.out.lagging.read();
    const cold = ichimoku(f.source, { conversion: 3, base: 3, span: 3, displacement: 2 }).out.lagging.read();
    expect(landed).toEqual(cold);
    expect(landed[3].y).toBe(5);
    expect(landed[4].y).toBe(6);
  });

  it("equals a cold computation after a page, and keeps the objects past the corrected prefix", () => {
    const f = feed(bars(500, 900));
    const node = ichimoku(f.source, { ahead: minute });
    const branches = (n: typeof node) => [
      ["conversion", n.out.conversion.read()],
      ["base", n.out.base.read()],
      ["spanA", n.out.spanA.read()],
      ["spanB", n.out.spanB.read()],
      ["lagging", n.out.lagging.read()],
      ["cloud", n.out.cloud.read()],
    ] as const;
    const before = branches(node);
    f.prepend(bars(480, 500));
    const cold = branches(ichimoku(f.source, { ahead: minute }));
    const landed = branches(node);
    for (let b = 0; b < landed.length; b++) {
      const [key, got] = landed[b];
      expect(got, key).toEqual(cold[b][1]);
      // count 20 + look (52 − 1 + 26 = 77) = 97 positions are recomputed; everything after is the old object.
      const was = before[b][1];
      const shift = got.length - was.length;
      expect(shift).toBe(20);
      for (let i = 97; i < got.length; i++) expect(got[i], `${key}[${i}]`).toBe(was[i - shift]);
    }
  });

  it("recomputes the projection when the history is too short for its window to be untouched", () => {
    const short = (i: number): OHLC => ({ x: i, open: i, high: i + 0.5, low: i - 0.5, close: i });
    const f = feed([short(3)]);
    const node = ichimoku(f.source, { conversion: 3, base: 3, span: 3, displacement: 2, ahead: (x, k) => x + k });
    const before = node.out.spanB.read();
    expect(before.map((p) => p.y)).toEqual([null, null, null]);
    f.prepend([0, 1, 2].map(short));
    const landed = node.out.spanB.read();
    const cold = ichimoku(f.source, { conversion: 3, base: 3, span: 3, displacement: 2, ahead: (x, k) => x + k }).out.spanB.read();
    expect(landed).toEqual(cold);
    expect(landed[4].y).toBe(1);
    expect(landed[5].y).toBe(2);
  });

  it("falls back to a full computation when the page also corrected the old head", () => {
    // A page of 10 whose landing also replaces the first 5 old bars (new
    // objects, a much higher high). Those sit at new positions 10..14 and
    // reach outputs up to 14 + look — past the count + look prefix the door
    // would recompute — so accepting the correction would leave stale bars.
    const old = bars(500, 700);
    let data = old;
    const node = ichimoku({ read: () => data });
    node.out.spanB.read();
    const corrected = old.slice(0, 5).map((c) => ({ ...c, high: c.high + 1000 }));
    data = [...bars(490, 500), ...corrected, ...old.slice(5)];
    const landed = node.out.spanB.read();
    const cold = ichimoku({ read: () => data }).out.spanB.read();
    expect(landed).toEqual(cold);
  });
});

describe("attachIchimoku — ahead", () => {
  it("extends the chart's x range to the projected cloud, so the fit shows it", () => {
    const data = bars(0, 100);
    const model = createPlotModel({
      size: { width: 800, height: 400 },
      series: { series: candleSeries(), data },
    });
    model.plot.mainPane.use(attachIchimoku({ source: { read: () => data }, ahead: minute }));
    model.plot.fitDomains();
    model.plot.render();
    const domain = model.plot.getVisibleRange();
    // The last projected slot, plus the fit's half bar.
    expect(domain?.max).toBe(minute(data[99].x, 26.5));
  });

  it("gives the projected x a bar slot under barIndexX", () => {
    const data = bars(0, 100);
    const model = createPlotModel({
      size: { width: 800, height: 400 },
      series: { series: candleSeries(), data },
      deps: { createXMapping: barIndexX },
    });
    model.plot.mainPane.use(attachIchimoku({ source: { read: () => data }, ahead: minute }));
    model.plot.fitDomains();
    model.plot.render();
    // The last projected slot, plus the fit's half bar.
    expect(model.plot.getVisibleRange()?.max).toBe(minute(data[99].x, 26.5));
  });
});

describe("ichimoku cloud extent", () => {
  const bar = (x: number, close: number, volume = 100): OHLC => ({
    x, open: close, high: close, low: close, close, volume,
  });

  it('claims both Ichimoku cloud bounds when span A falls below span B', () => {
    const data = Array.from({ length: 20 }, (_, i) => bar(i, 100 - i * 2));
    const cloud = ichimoku({ read: () => data }, { conversion: 2, base: 3, span: 5, displacement: 0 }).out.cloud.read();
    const values = cloud.flatMap(p => p.upper === null || p.lower === null ? [] : [p.upper, p.lower]);
    expect(bandSeries().valueExtent([...cloud])).toEqual({ min: Math.min(...values), max: Math.max(...values) });
  });
});
