/**
 * The computation node's head gate — `calcFirst` runs only when every
 * input's change reads as a prepend (or nothing), its result is committed
 * with the same "only success advances the cache" rule as `calcLast`, and
 * `null` falls back to the full computation.
 */
import { describe, expect, it } from "vitest";
import { computation } from "../computation";
import type { Source } from "../types";

interface Pt {
  x: number;
}

function feed(initial: Pt[]) {
  let data = initial;
  const source: Source<Pt> = { read: () => data };
  return {
    source,
    prepend(older: Pt[]) {
      data = [...older, ...data];
    },
    swap(next: Pt[]) {
      data = next;
    },
  };
}

const pts = (from: number, to: number): Pt[] => {
  const out: Pt[] = [];
  for (let x = from; x < to; x++) out.push({ x });
  return out;
};

describe("headLookback — the declared door", () => {
  it("lands a page by running calc on the prefix only — page + lookback, not the world", () => {
    const seen: number[] = [];
    const f = feed(pts(10, 30));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        seen.push(data.length);
        // A 3-window mean — warmup nulls kept, 1:1 with positions.
        return {
          line: data.map((p, i) => ({
            x: p.x,
            y: i >= 2 ? (data[i - 2].x + data[i - 1].x + p.x) / 3 : null,
          })),
        };
      },
      headLookback: 2,
    });
    node.out.line.read();
    expect(seen).toEqual([20]);

    f.prepend(pts(4, 10));
    node.out.line.read();

    // The landing reran calc over count + lookback positions, nothing more.
    expect(seen).toEqual([20, 8]);
  });

  it("computes the landed head plus the corrected zone, exactly", () => {
    const f = feed(pts(10, 30));
    const node = computation({
      inputs: [f.source],
      calc: (data) => ({
        line: data.map((p, i) => ({
          x: p.x,
          y: i >= 2 ? (data[i - 2].x + data[i - 1].x + p.x) / 3 : null,
        })),
      }),
      headLookback: 2,
    });
    const before = node.out.line.read();

    f.prepend(pts(4, 10));
    const after = node.out.line.read();

    // Cold reference: the same calc over everything.
    const all = pts(4, 30);
    const want = all.map((p, i) =>
      i >= 2 ? (all[i - 2].x + all[i - 1].x + p.x) / 3 : null,
    );
    expect(after.map((p) => p.y)).toEqual(want);
    // The tail beyond the corrected zone is the previous objects, reused.
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
    expect(after[8]).toBe(before[2]);
    // The corrected zone (warmup filling in) is fresh.
    expect(after[6]).not.toBe(before[0]);
  });

  it("falls back to the full path when a branch is not 1:1 with positions", () => {
    const calls = { full: 0 };
    const f = feed(pts(10, 30));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        calls.full++;
        return { bricks: data.filter((_, i) => i % 3 === 0).map((p, i) => ({ x: i, y: p.x })) };
      },
      headLookback: 2,
    });
    node.out.bricks.read();

    f.prepend(pts(4, 10));
    const after = node.out.bricks.read();

    // initial + the door's prefix probe (whose shape came back non-1:1) + the full path
    expect(calls.full).toBe(3);
    expect(after).toHaveLength(pts(4, 30).filter((_, i) => i % 3 === 0).length);
  });

  it("declines a head longer than the sliced prefix — 1:1 is enforced, not inferred", () => {
    // A non-1:1 calc that emits MORE outputs than inputs used to slip a
    // corrupted stitch into the node whenever its length landed inside
    // [count, count + tail]; the strict per-branch check declines it and
    // the full path answers with the calc's own honest output.
    const calls = { full: 0 };
    const f = feed(pts(10, 30));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        calls.full++;
        // Emits two points per input — never position-aligned.
        return { doubled: data.flatMap((p) => [{ x: p.x }, { x: p.x + 0.5 }]) };
      },
      headLookback: 2,
    });
    const whole = node.out.doubled.read();
    expect(whole).toHaveLength(40);

    f.prepend(pts(5, 10));
    const after = node.out.doubled.read();

    expect(calls.full).toBe(3); // initial + declined prefix probe + full
    expect(after).toHaveLength(50); // the honest full output, no stitched hybrid
  });

  it("declines when one input's whole history is shorter than the prefix — lengths disagree", () => {
    // Equal counts landing on unequal histories still share a position
    // axis (both shift together), so that alone is fine — the door only
    // has no footing when an input can't even fill the prefix, making
    // the sliced lengths disagree. Declined before the probe runs.
    const calls = { full: 0 };
    const a = feed(pts(10, 30));
    const b = feed(pts(28, 30)); // two points of history — shorter than count + lookback
    const node = computation({
      inputs: [a.source, b.source],
      calc: (left, right) => {
        calls.full++;
        return { sum: left.map((p, i) => ({ x: p.x, y: p.x + (right[i]?.x ?? 0) })) };
      },
      headLookback: 3,
    });
    node.out.sum.read();

    a.prepend(pts(5, 10));
    b.prepend(pts(23, 28));
    node.out.sum.read();
    expect(calls.full).toBe(2); // initial + the full path — no probe, no stitch
  });

  it("falls back when inputs landed different counts — slicing would misalign them", () => {
    const calls = { full: 0 };
    const a = feed(pts(10, 30));
    const b = feed(pts(10, 30));
    const node = computation({
      inputs: [a.source, b.source],
      calc: (left, right) => {
        calls.full++;
        return { sum: left.map((p, i) => ({ x: p.x, y: p.x + (right[i]?.x ?? 0) })) };
      },
      headLookback: 0,
    });
    node.out.sum.read();

    a.prepend(pts(5, 10));
    b.prepend(pts(7, 10));
    node.out.sum.read();
    expect(calls.full).toBe(2);
  });

  it("refuses a spec carrying both doors — one way per direction", () => {
    const f = feed(pts(10, 30));
    expect(() =>
      computation({
        inputs: [f.source],
        calc: (data) => ({ line: data.map((p) => ({ x: p.x })) }),
        calcFirst: (previous) => previous,
        headLookback: 3,
      }),
    ).toThrow(/calcFirst|headLookback/);
  });
});

describe("calcFirst", () => {
  it("runs on a prepend and its output rule carries identity downstream", () => {
    const calls = { full: 0, head: 0 };
    const f = feed(pts(10, 20));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        calls.full++;
        return { line: data.map((p) => ({ x: p.x })) };
      },
      calcFirst: (previous, [data], [change]) => {
        if (change.kind === "none") return previous;
        calls.head++;
        const head = data.slice(0, change.count).map((p) => ({ x: p.x }));
        return { line: [...head, ...previous.line] };
      },
    });
    const before = node.out.line.read();

    f.prepend(pts(5, 10));
    const after = node.out.line.read();

    expect(calls).toEqual({ full: 1, head: 1 });
    expect(after.map((p) => p.x)).toEqual(pts(5, 20).map((p) => p.x));
    // The reused tail keeps identity — downstream consumers classify this
    // landing off these very objects.
    expect(after[5]).toBe(before[0]);
  });

  it("falls back to the full computation when calcFirst returns null", () => {
    const calls = { full: 0 };
    const f = feed(pts(10, 20));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        calls.full++;
        return { line: data.map((p) => ({ x: p.x })) };
      },
      calcFirst: () => null,
    });
    node.out.line.read();

    f.prepend(pts(5, 10));
    expect(node.out.line.read()).toHaveLength(15);
    expect(calls.full).toBe(2);
  });

  it("takes the full path when any input's change is not a prepend", () => {
    const calls = { full: 0, head: 0 };
    const f = feed(pts(10, 20));
    const node = computation({
      inputs: [f.source],
      calc: (data) => {
        calls.full++;
        return { line: data.map((p) => ({ x: p.x })) };
      },
      calcFirst: () => {
        calls.head++;
        return null;
      },
    });
    node.out.line.read();

    f.swap(pts(0, 30));
    node.out.line.read();
    expect(calls).toEqual({ full: 2, head: 0 });
  });

  it("keeps the cache key put when calcFirst throws — the next read retries", () => {
    let boom = true;
    const f = feed(pts(10, 20));
    const node = computation({
      inputs: [f.source],
      calc: (data) => ({ line: data.map((p) => ({ x: p.x })) }),
      calcFirst: (previous, [data], [change]) => {
        if (change.kind === "none") return previous;
        if (boom) throw new Error("flaky");
        const head = data.slice(0, change.count).map((p) => ({ x: p.x }));
        return { line: [...head, ...previous.line] };
      },
    });
    node.out.line.read();

    f.prepend(pts(5, 10));
    expect(() => node.out.line.read()).toThrow("flaky");
    boom = false;
    expect(node.out.line.read().map((p) => p.x)).toEqual(pts(5, 20).map((p) => p.x));
  });
});

it("propagates an upstream corrected prefix through the declared lookback", () => {
  let values = [2, 3, 4, 5, 6].map(x => ({ x, y: x }));
  const calc = (data: readonly Readonly<{ x: number; y: number }>[]) => ({
    line: data.map((p, i) => ({ x: p.x, y: i === 0 ? null : data[i - 1].y + p.y })),
  });
  const node = computation({ inputs: [{ read: () => values }], calc, headLookback: 1 });
  const before = node.out.line.read();
  values = [{ x: 1, y: 1 }, { x: 2, y: 20 }, { x: 3, y: 30 }, ...values.slice(2)];
  const after = node.out.line.read();
  expect(after).toEqual(calc(values).line);
  expect(after[4]).toBe(before[3]);
  values = [...values, { x: 7, y: 7 }];
  expect(node.out.line.read()).toEqual(calc(values).line);
});
