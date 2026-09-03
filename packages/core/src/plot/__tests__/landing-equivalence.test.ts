/**
 * The net under the landing-hitch surgery — set up BEFORE any fast path
 * exists, so every stage of it has to stay green underneath.
 *
 * Property: **page splitting is invisible.** A chart that received its
 * history as an arbitrary sequence of prepends draws exactly what the
 * same chart receiving that history as one prepend draws. Today both
 * sides take the full route, so this passes against current code; once
 * head-splice, headDelta, and the mapping's head fast path land, this is
 * what catches a silently-wrong body — the failure mode detection-based
 * designs can't see (a seeded recursion changes every body value while
 * length and x stay identical).
 *
 * The reference is "one big prepend", not "one setData": under bar-index
 * x the index origin is anchored to the bars present at first fit — by
 * design (that anchoring is what keeps the viewport still while history
 * lands) — so a chart loaded fresh with all data has a different origin
 * and a different default-tick phase. Same origin on both sides makes
 * strict equality meaningful. Under continuous x the origin doesn't
 * exist, so there the drawn scene is also checked against a fresh
 * all-at-once chart.
 *
 * Deterministic: every case runs off a seeded PRNG and the seed is in the
 * test name — a red run reproduces by itself.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { computation } from "../../data";
import { barIndexX } from "../../scale";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel, type PlotModel } from "../model";

/**
 * Deep equality with a bounded numeric tolerance. Structure, strings and
 * x-exactness stay strict; numbers may differ by 1e-9 relative.
 *
 * The tolerance is not a softening of the net but a statement of the real
 * contract: the tail door resumes the *same* fold (path-continuing, so
 * bitwise equal), while a head door restarts the fold on a new prefix —
 * and a running-sum kernel's rounding path is history-dependent, so the
 * last bits of the body legitimately drift with how history arrived.
 * Every bug this net exists to catch (a stale head, an off-by-one shift,
 * a swallowed bar, warmup nulls left behind) moves values by five-plus
 * orders of magnitude more than this bound.
 */
function expectApprox(actual: unknown, expected: unknown, label: string): void {
  if (typeof expected === "number" && typeof actual === "number") {
    if (Number.isNaN(expected)) {
      expect(actual, label).toBeNaN();
      return;
    }
    const bound = Math.max(1e-9, Math.abs(expected) * 1e-9);
    if (Math.abs(actual - expected) > bound) {
      expect(actual, label).toBe(expected); // fails with the full diff
    }
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || actual.length !== expected.length) {
      expect(actual, label).toEqual(expected);
      return;
    }
    for (let i = 0; i < expected.length; i++) {
      expectApprox(actual[i], expected[i], `${label}[${i}]`);
    }
    return;
  }
  if (expected !== null && typeof expected === "object" && actual !== null && typeof actual === "object") {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.join() !== actualKeys.join()) {
      expect(actual, label).toEqual(expected);
      return;
    }
    const left = actual as Record<string, unknown>;
    const right = expected as Record<string, unknown>;
    for (const key of expectedKeys) {
      expectApprox(left[key], right[key], `${label}.${key}`);
    }
    return;
  }
  if (actual !== expected) expect(actual, label).toEqual(expected);
}

/** mulberry32 — tiny, deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bars with the shapes the sorted-x contract allows for bars: irregular
 * spacing, occasional weekend-sized holes. A repeated x is line data's
 * privilege (`incremental.test.ts`, `x-mapping.test.ts`) — bars declare
 * `uniqueX`, so the fixture never repeats one.
 */
function makeBars(random: () => number, count: number): OHLC[] {
  const out: OHLC[] = [];
  let x = 1_000;
  let value = 100;
  for (let i = 0; i < count; i++) {
    const roll = random();
    if (i > 0) {
      if (roll < 0.16) {
        x += 60 * (2 + Math.floor(random() * 40)); // a hole
      } else {
        x += 60;
      }
    }
    value = Math.max(5, value + (random() - 0.5) * 4);
    const spread = random() * 2 + 0.2;
    out.push({
      x,
      open: value - spread / 2,
      close: value + spread / 2,
      high: value + spread,
      low: value - spread,
    });
  }
  return out;
}

/** Windowed — warmup nulls at the head correct themselves on prepend. */
const sma = (period: number) => (source: readonly OHLC[]): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  let sum = 0;
  for (let i = 0; i < source.length; i++) {
    sum += source[i].close;
    if (i >= period) sum -= source[i - period].close;
    out.push({ x: source[i].x, y: i >= period - 1 ? sum / period : null });
  }
  return out;
};

/**
 * Seeded recursion, heikin-ashi style — a prepend changes EVERY body value
 * while length and every x stay identical. The exact case length/x
 * detection cannot see.
 */
const seededRecursive = (source: readonly OHLC[]): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  let previous = 0;
  for (let i = 0; i < source.length; i++) {
    previous = i === 0 ? source[0].open : (previous + source[i - 1].close) / 2;
    out.push({ x: source[i].x, y: previous });
  }
  return out;
};

/** Cumulative from the head, vwap style — no decay, the whole body shifts. */
const cumulative = (source: readonly OHLC[]): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  let sum = 0;
  for (let i = 0; i < source.length; i++) {
    sum += source[i].close;
    out.push({ x: source[i].x, y: sum / (i + 1) });
  }
  return out;
};

/** Length-changing, renko style — output count and ordinal x both move on prepend. */
const brick = (source: readonly OHLC[]): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  let anchor: number | null = null;
  for (const bar of source) {
    if (anchor === null || Math.abs(bar.close - anchor) >= 2) {
      anchor = bar.close;
      out.push({ x: out.length, y: anchor });
    }
  }
  return out;
};

/** A windowed head derivation — sma's shape: fold the prefix, reuse the tail. */
function smaHeadDoor(period: number) {
  return {
    lookback: period - 1,
    head: (
      previous: readonly LineDataPoint[],
      source: readonly OHLC[],
      change: { kind: "prepend"; count: number },
    ): LineDataPoint[] => {
      const upto = change.count + Math.min(period - 1, previous.length);
      return sma(period)(source.slice(0, upto));
    },
  };
}

interface Registered {
  model: PlotModel;
  reads: (() => readonly { x: number }[])[];
  /** The four data-owning handles, in registration order — the prepend targets. */
  ownedHandles: { prepend(points: OHLC[]): void }[];
}

/** One chart with every registration family the surgery touches. */
function build(data: OHLC[], barIndexed: boolean): Registered {
  const model = createPlotModel({
    size: { width: 800, height: 500 },
    series: null,
    deps: barIndexed ? { createXMapping: barIndexX } : undefined,
  });
  const price = model.plot.mainPane.addSeries({ series: candleSeries(), data });
  const windowed = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data,
    derive: sma(7),
  });
  const doored = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data,
    derive: sma(9),
    deriveFirst: smaHeadDoor(9),
  });
  const recursive = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data,
    derive: seededRecursive,
  });
  const bricks = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data,
    derive: brick,
  });
  const node = computation({
    inputs: [price],
    calc: (candles) => ({ mean: cumulative(candles), fast: sma(3)(candles) }),
    calcFirst: (previous, [candles], [change]) => {
      if (change.kind === "none") return previous;
      // The window branch folds its prefix and reuses the tail; the
      // cumulative branch can't resume from the head (its seed moved),
      // and answering for it wrongly is exactly what the equivalence net
      // exists to catch — so the node declines the landing whole.
      void candles;
      void previous;
      return null;
    },
  });
  const lower = model.plot.addPane({ flex: 0.4 });
  lower.addSeries({ series: lineSeries(), input: node.out.mean });
  lower.addSeries({ series: lineSeries(), input: node.out.fast });

  return {
    model,
    reads: [
      () => price.read(),
      () => windowed.read(),
      () => doored.read(),
      () => recursive.read(),
      () => bricks.read(),
      () => node.out.mean.read(),
      () => node.out.fast.read(),
    ],
    ownedHandles: [price, windowed, doored, recursive, bricks],
  };
}

function runCase(seed: number, barIndexed: boolean): void {
  const random = rng(seed);
  const total = 200 + Math.floor(random() * 400);
  const all = makeBars(random, total);

  // Split the head into 3..8 pages; sizes include 1 (the tail-path landmine).
  const pages: OHLC[][] = [];
  let cut = total - (60 + Math.floor(random() * 60)); // the initial tail chunk
  const initial = all.slice(cut);
  while (cut > 0 && pages.length < 7) {
    const size =
      random() < 0.2 ? 1 : Math.min(cut, 1 + Math.floor(random() * 120));
    pages.unshift(all.slice(cut - size, cut));
    cut -= size;
  }
  if (cut > 0) pages.unshift(all.slice(0, cut));

  const incremental = build([...initial], barIndexed);

  // Newest page first: pages arrive the way infiniteHistory delivers them.
  const prependTargets = incremental.ownedHandles;
  for (let i = pages.length - 1; i >= 0; i--) {
    for (const target of prependTargets) target.prepend([...pages[i]]);
    incremental.model.plot.render();
  }

  // The reference shares the incremental chart's origin: same initial
  // chunk, then the whole head as a single page.
  const head = all.slice(0, all.length - initial.length);
  const reference = build([...initial], barIndexed);
  if (head.length > 0) {
    for (const target of reference.ownedHandles) target.prepend([...head]);
  }

  // Same viewport on both — commands compare covers slicing, decimation,
  // the mapping (indices, places), grid, and labels in one shot.
  const span = all[all.length - 1].x - all[0].x;
  const from = all[0].x + span * 0.1;
  const to = all[0].x + span * 0.6;
  incremental.model.plot.setVisibleRange(from, to);
  reference.model.plot.setVisibleRange(from, to);
  incremental.model.plot.render();
  reference.model.plot.render();

  for (let i = 0; i < incremental.reads.length; i++) {
    expectApprox(
      incremental.reads[i](),
      reference.reads[i](),
      `seed ${seed} registration ${i}`,
    );
  }
  expectApprox(
    incremental.model.commands(),
    reference.model.commands(),
    `seed ${seed} drawn commands`,
  );

  // Continuous x has no path-dependent origin — there the scene must also
  // match a chart handed everything at once.
  if (!barIndexed) {
    const fresh = build([...all], false);
    fresh.model.plot.setVisibleRange(from, to);
    fresh.model.plot.render();
    expectApprox(
      incremental.model.commands(),
      fresh.model.commands(),
      `seed ${seed} vs fresh`,
    );
  }
}

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe("landing equivalence — prepends draw what one setData draws", () => {
  it.each(SEEDS)("continuous x · seed %i", (seed) => runCase(seed, false));
  it.each(SEEDS)("bar-index x · seed %i", (seed) => runCase(seed, true));
});
