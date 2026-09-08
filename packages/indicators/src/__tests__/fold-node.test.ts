import type { OHLC, Source } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { foldNode } from "../fold-node";
import { lagFold, sumFold, type LagState, type SumState } from "../kernels";
import { toneOf } from "../tone";

/**
 * The builder is what makes "increment and full path stand on the same
 * fold" a fact rather than a discipline. So the guards are about the
 * builder, not any indicator: a tick sequence (appends and replaces,
 * interleaved) equals a cold node bit for bit; the prefix keeps its
 * objects; a replace deeper than one bar takes the full path; and the
 * checkpoints sit where they must — just before the last step.
 */

const bar = (i: number): OHLC => {
  const v = 100 + Math.sin(i / 5) * 7 + (i % 3);
  return { x: i * 60, open: v, high: v + 1, low: v - 1, close: v + 0.25 };
};
const bars = (from: number, to: number): OHLC[] => Array.from({ length: to - from }, (_, i) => bar(from + i));

function feed(initial: OHLC[]) {
  let data = initial;
  const source: Source<OHLC> = { read: () => data };
  return {
    source,
    prepend: (older: OHLC[]) => void (data = [...older, ...data]),
    append: (next: OHLC) => void (data = [...data, next]),
    replaceLast: (next: OHLC) => void (data = [...data.slice(0, -1), next]),
    replaceLastTwo: (a: OHLC, b: OHLC) => void (data = [...data.slice(0, -2), a, b]),
    read: () => data,
  };
}

interface Folds {
  sum: ReturnType<typeof sumFold>;
  lag: ReturnType<typeof lagFold>;
  made: number;
}
interface State {
  sum: SumState;
  lag: LagState;
}

/** A three-bar sum of close, and close minus close two bars back — two branches, two kinds of memory. */
function sample(source: Source<OHLC>, log: string[] = []) {
  let made = 0;
  return foldNode<OHLC, Folds, State, "sum3" | "mom2">(source, {
    keys: ["sum3", "mom2"],
    make: () => {
      made += 1;
      log.push(`make:${made}`);
      return { sum: sumFold(3), lag: lagFold(2), made };
    },
    snapshot: (f) => ({ sum: f.sum.snapshot(), lag: f.lag.snapshot() }),
    restore: (f, s) => {
      f.sum.restore(s.sum);
      f.lag.restore(s.lag);
    },
    step: (f, candle) => {
      const back = f.lag.step(candle.close);
      return {
        sum3: f.sum.step(candle.close),
        mom2: back === null ? null : candle.close - back,
      };
    },
    headLookback: 2,
  });
}

/**
 * The same node with `mom2` toned — the builder, not the step, writes the
 * tone. A bar with a range wider than 5 is a hole in `mom2` (a null the
 * tone must not look across).
 */
function tonedSample(source: Source<OHLC>) {
  return foldNode<OHLC, Folds, State, "sum3" | "mom2", "mom2">(source, {
    keys: ["sum3", "mom2"],
    toneKeys: ["mom2"],
    make: () => ({ sum: sumFold(3), lag: lagFold(2), made: 0 }),
    snapshot: (f) => ({ sum: f.sum.snapshot(), lag: f.lag.snapshot() }),
    restore: (f, s) => {
      f.sum.restore(s.sum);
      f.lag.restore(s.lag);
    },
    step: (f, candle) => {
      const back = f.lag.step(candle.close);
      return {
        sum3: f.sum.step(candle.close),
        mom2: back === null || candle.high - candle.low > 5 ? null : candle.close - back,
      };
    },
    headLookback: 2 + 1,
  });
}

/** A running sum — its lookback is unbounded, so it declares no door. */
function cumulativeSample(source: Source<OHLC>, door?: number) {
  return foldNode<OHLC, { total: number }, { total: number }, "total">(source, {
    keys: ["total"],
    make: () => ({ total: 0 }),
    snapshot: (f) => ({ total: f.total }),
    restore: (f, s) => void (f.total = s.total),
    step: (f, candle) => {
      f.total += candle.close;
      return { total: f.total };
    },
    ...(door === undefined ? {} : { headLookback: door }),
  });
}

/** `mom2` divides by the close — a bar closing at 0 makes Infinity, a NaN comes from 0/0. */
function dividingSample(source: Source<OHLC>) {
  return foldNode<OHLC, Folds, State, "sum3" | "mom2", "mom2">(source, {
    keys: ["sum3", "mom2"],
    toneKeys: ["mom2"],
    make: () => ({ sum: sumFold(3), lag: lagFold(1), made: 0 }),
    snapshot: (f) => ({ sum: f.sum.snapshot(), lag: f.lag.snapshot() }),
    restore: (f, s) => {
      f.sum.restore(s.sum);
      f.lag.restore(s.lag);
    },
    step: (f, candle) => {
      const back = f.lag.step(candle.close);
      return { sum3: f.sum.step(candle.close), mom2: back === null ? null : (candle.close - back) / candle.close };
    },
    // sumFold(3) remembers two bars; the lag one — the spec's memory is the larger.
    headLookback: 2,
  });
}

describe("foldNode emits finite or null", () => {
  it("a step value that is not finite is no reading — on the full path, the tail path, and a toned branch", () => {
    const f = feed([bar(0), { ...bar(1), close: 0 }, bar(2), { ...bar(3), close: 0 }, { ...bar(4), close: 0 }]);
    const node = dividingSample(f.source);
    const full = node.out.mom2.read();
    // i1: (0 − c0)/0 = −Infinity → null; i3: (0 − c2)/0 → null; i4: 0/0 = NaN → null.
    expect(full.map((p) => p.y)).toEqual([null, null, expect.any(Number), null, null]);
    expect(full.every((p) => p.y === null || Number.isFinite(p.y))).toBe(true);
    expect(full[3].tone).toBeUndefined();
    f.append({ ...bar(5), close: 0 });
    const tail = node.out.mom2.read();
    expect(tail[5].y).toBeNull();
    expect(tail[5].tone).toBeUndefined();
  });

  it("a value that saturates at the largest double is no reading either", () => {
    const node = foldNode<OHLC, { n: number }, { n: number }, "v">({ read: () => bars(0, 3) }, {
      keys: ["v"],
      make: () => ({ n: 0 }),
      snapshot: (f) => ({ n: f.n }),
      restore: (f, s) => void (f.n = s.n),
      step: (f) => ({ v: [1, Number.MAX_VALUE, -Number.MAX_VALUE][f.n++] ?? null }),
      headLookback: 0,
    });
    expect(node.out.v.read().map((p) => p.y)).toEqual([1, null, null]);
  });
});

describe("foldNode without a head door", () => {
  it("a spec that omits headLookback lands a page by recomputing everything — the tail is rebuilt, not kept", () => {
    const f = feed(bars(100, 160));
    const node = cumulativeSample(f.source);
    const before = node.out.total.read();
    f.prepend(bars(0, 100));
    const after = node.out.total.read();
    const cold = cumulativeSample({ read: () => f.read() }).out.total.read();
    expect(after.map((p) => p.y)).toEqual(cold.map((p) => p.y));
    // A declared door keeps the settled tail's objects; no door means nothing was kept.
    expect(after[after.length - 1]).not.toBe(before[before.length - 1]);
  });

  it("the same spec with a finite door keeps its tail — and, being cumulative, gets it wrong", () => {
    const f = feed(bars(100, 160));
    const node = cumulativeSample(f.source, 10);
    const before = node.out.total.read();
    f.prepend(bars(0, 100));
    const after = node.out.total.read();
    const cold = cumulativeSample({ read: () => f.read() }).out.total.read();
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
    expect(after[after.length - 1].y).not.toBe(cold[cold.length - 1].y);
  });

  it("still ticks as an increment without a door", () => {
    const f = feed(bars(0, 20));
    const node = cumulativeSample(f.source);
    const before = [...node.out.total.read()];
    f.append(bar(20));
    const after = node.out.total.read();
    for (let i = 0; i < 20; i++) expect(after[i]).toBe(before[i]);
    expect(after[20].y).toBe(cumulativeSample({ read: () => f.read() }).out.total.read()[20].y);
  });
});

describe("foldNode.toneKeys", () => {
  it("writes the tone on a toned branch only, and always as a key — the point shape is fixed per branch", () => {
    const node = tonedSample({ read: () => bars(0, 10) });
    const toned = node.out.mom2.read();
    const plain = node.out.sum3.read();
    for (const point of toned) expect("tone" in point, "a toned branch always carries the key").toBe(true);
    for (const point of plain) expect("tone" in point, "a plain branch never does").toBe(false);
    // The rule, against the branch's own previous value.
    for (let i = 0; i < toned.length; i++) {
      expect(toned[i].tone, `tone[${i}]`).toBe(toneOf(i > 0 ? toned[i - 1].y : undefined, toned[i].y));
    }
    expect(toned[2].tone).toBeUndefined(); // the first value has no previous
    expect(toned.slice(3).every((p) => p.tone !== undefined)).toBe(true);
  });

  it("a tick sequence carries the same tones as a cold node — the seam reads its previous from the kept prefix", () => {
    const f = feed(bars(0, 40));
    const node = tonedSample(f.source);
    node.out.mom2.read();
    const ticks: (() => void)[] = [
      () => f.append(bar(40)),
      () => f.replaceLast({ ...bar(40), close: 130 }),
      () => f.replaceLast({ ...bar(40), close: 60 }),
      () => f.append(bar(41)),
      () => f.replaceLast({ ...bar(41), close: 61 }),
    ];
    for (const tick of ticks) {
      tick();
      const live = node.out.mom2.read();
      const cold = tonedSample({ read: () => f.read() }).out.mom2.read();
      expect(live.map((p) => p.tone), "after a tick").toEqual(cold.map((p) => p.tone));
      expect(live[live.length - 1].tone, "the live bar's tone").toBe(cold[cold.length - 1].tone);
    }
  });

  it("grows from nothing, takes a multi-bar append, and does not look across a hole", () => {
    const hole = (i: number): OHLC => ({ ...bar(i), high: bar(i).close + 4, low: bar(i).close - 4 });
    const f = feed([]);
    const node = tonedSample(f.source);
    expect(node.out.mom2.read()).toEqual([]);
    const steps: (() => void)[] = [
      () => f.append(bar(0)), // from === 0 — nothing to look back into
      () => f.append(bar(1)),
      () => f.append(bar(2)),
      () => f.append(bar(3)),
      () => void (f.append(bar(4)), f.append(bar(5))), // two bars in one tick
      () => f.append(hole(6)), // the hole itself
      () => f.append(bar(7)), // right after the hole — no tone
      () => f.replaceLast({ ...bar(7), close: 500 }),
      () => f.append(bar(8)),
    ];
    for (const step of steps) {
      step();
      const live = node.out.mom2.read();
      const cold = tonedSample({ read: () => f.read() }).out.mom2.read();
      expect(live.map((p) => [p.y, p.tone]), `after ${live.length} bars`).toEqual(cold.map((p) => [p.y, p.tone]));
    }
    const final = node.out.mom2.read();
    expect(final[6].y).toBeNull();
    expect(final[7].tone, "after a hole").toBeUndefined();
    expect(final[8].tone).toBeDefined();
  });

  it("keeps the prefix objects on a tick, tone and all", () => {
    const f = feed(bars(0, 20));
    const node = tonedSample(f.source);
    const before = [...node.out.mom2.read()];
    f.append(bar(20));
    const after = node.out.mom2.read();
    for (let i = 0; i < 20; i++) expect(after[i]).toBe(before[i]);
  });
});

describe("foldNode", () => {
  it("names its branches even on an empty input", () => {
    const node = sample({ read: () => [] });
    expect(Object.keys(node.out).sort()).toEqual(["mom2", "sum3"]);
    expect(node.out.sum3.read()).toEqual([]);
  });

  it("a tick sequence equals a cold node, bit for bit, on every branch", () => {
    const f = feed(bars(0, 40));
    const node = sample(f.source);
    node.out.sum3.read();
    const ticks: (() => void)[] = [
      () => f.append(bar(40)),
      () => f.replaceLast({ ...bar(40), close: 130 }),
      () => f.replaceLast({ ...bar(40), close: 131 }),
      () => f.append(bar(41)),
      () => f.append(bar(42)),
      () => f.replaceLast({ ...bar(42), close: 90 }),
    ];
    for (const tick of ticks) {
      tick();
      node.out.sum3.read();
      node.out.mom2.read();
    }
    const cold = sample({ read: () => f.read() });
    for (const key of ["sum3", "mom2"] as const) {
      expect(node.out[key].read().map((p) => p.y)).toEqual(cold.out[key].read().map((p) => p.y));
      expect(node.out[key].read().map((p) => p.x)).toEqual(f.read().map((c) => c.x));
    }
  });

  it("a replace as the very first tick resumes from the checkpoint calc took — before the last step", () => {
    const f = feed(bars(0, 30));
    const node = sample(f.source);
    node.out.sum3.read();
    f.replaceLast({ ...bar(29), close: 250 });
    node.out.sum3.read();
    node.out.mom2.read();
    const cold = sample({ read: () => f.read() });
    for (const key of ["sum3", "mom2"] as const) {
      expect(node.out[key].read().map((p) => p.y)).toEqual(cold.out[key].read().map((p) => p.y));
    }
  });

  it("keeps the prefix objects on a tick — downstream reads a tail change", () => {
    const f = feed(bars(0, 20));
    const node = sample(f.source);
    const before = [...node.out.sum3.read()];
    f.append(bar(20));
    const after = node.out.sum3.read();
    for (let i = 0; i < 20; i++) expect(after[i]).toBe(before[i]);
    expect(after).toHaveLength(21);

    const beforeReplace = [...after];
    f.replaceLast({ ...bar(20), close: 5 });
    const replaced = node.out.sum3.read();
    for (let i = 0; i < 20; i++) expect(replaced[i]).toBe(beforeReplace[i]);
    expect(replaced[20]).not.toBe(beforeReplace[20]);
  });

  it("a tick is an increment — make() is not called again; a two-bar replace is the full path", () => {
    const log: string[] = [];
    const f = feed(bars(0, 20));
    const node = sample(f.source, log);
    node.out.sum3.read();
    expect(log).toEqual(["make:1", "make:2"]); // the tail folds, then calc's folds

    f.append(bar(20));
    node.out.sum3.read();
    expect(log).toHaveLength(2);

    f.replaceLastTwo({ ...bar(19), close: 1 }, { ...bar(20), close: 2 });
    node.out.sum3.read();
    expect(log).toEqual(["make:1", "make:2", "make:3"]);
    const cold = sample({ read: () => f.read() });
    expect(node.out.sum3.read().map((p) => p.y)).toEqual(cold.out.sum3.read().map((p) => p.y));
  });

  it("lands a page through the declared door, then ticks — still equal to a cold node", () => {
    const f = feed(bars(100, 160));
    const node = sample(f.source);
    node.out.sum3.read();
    f.prepend(bars(0, 100));
    node.out.sum3.read();
    f.replaceLast({ ...bar(159), close: 77 });
    node.out.sum3.read();
    f.append(bar(160));
    node.out.mom2.read();
    const cold = sample({ read: () => f.read() });
    for (const key of ["sum3", "mom2"] as const) {
      expect(node.out[key].read().map((p) => p.y)).toEqual(cold.out[key].read().map((p) => p.y));
    }
  });
});
