/**
 * Tail detection — there's exactly one thing to hold: never call something a
 * tail append when it isn't. Missing one just falls through to the full path
 * (slow but correct); misdetecting one makes an indicator silently wrong.
 */
import { describe, expect, it } from "vitest";
import { computation } from "../computation";
import { tailDelta } from "../tail-delta";
import type { Source } from "../types";

const points = (count: number) => Array.from({ length: count }, (_, i) => ({ x: i }));

describe("tailDelta", () => {
  it("append — it's an append if the front is all the same objects", () => {
    const prev = points(5);
    const next = [...prev, { x: 5 }, { x: 6 }];

    expect(tailDelta(prev, next)).toEqual({ kind: "append", count: 2 });
  });

  it("replace — it's replace 1 if only the last is a new object", () => {
    const prev = points(5);
    const next = [...prev.slice(0, 4), { x: 4 }];

    expect(tailDelta(prev, next)).toEqual({ kind: "replace", count: 1 });
  });

  it("it's none when it's a new array but every element's identity is the same", () => {
    const prev = points(5);

    expect(tailDelta(prev, [...prev])).toEqual({ kind: "none" });
  });

  /**
   * A change in the middle is not a tail — a sample check (a few points at
   * the front and back) would miss this and silently produce a wrong
   * indicator. That's why the shared range gets checked exhaustively. The
   * rule is one rule regardless of length: it's only a tail if the front is
   * entirely unchanged.
   */
  it("returns null when the middle diverges — even with a matching end or matching length", () => {
    const prev = points(5);
    const next = [...prev];
    next[2] = { x: 2 };

    expect(tailDelta(prev, next)).toBeNull();
    expect(tailDelta(prev, [...next, { x: 5 }])).toBeNull();
  });

  it("returns null when it shrank or is empty", () => {
    const prev = points(5);

    expect(tailDelta(prev, prev.slice(0, 3))).toBeNull();
    expect(tailDelta(prev, [])).toBeNull();
    expect(tailDelta([], points(3))).toBeNull();
  });
});

describe("computation.calcLast", () => {
  /** A stand-in source that updates while preserving identity — the same shape as the manager's tail operations. */
  function feed(initial: { x: number; y: number }[]) {
    let data = initial;
    return {
      source: { read: () => data } as Source<{ x: number; y: number }>,
      replaceLast(point: { x: number; y: number }) {
        data = [...data.slice(0, -1), point];
      },
      append(point: { x: number; y: number }) {
        data = [...data, point];
      },
    };
  }

  const doubled = (data: { x: number; y: number }[]) =>
    data.map((p) => ({ x: p.x, y: p.y * 2 }));

  function counted() {
    const counts = { full: 0, tail: 0 };
    const wire = feed([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ]);
    const node = computation({
      inputs: [wire.source],
      calc: (data) => {
        counts.full += 1;
        return { out: doubled(data) };
      },
      calcLast: (previous, [data], [change]) => {
        counts.tail += 1;
        if (change.kind === "none") return previous;
        const count = change.kind === "replace" ? change.count : change.count;
        const keep =
          previous.out.length - (change.kind === "replace" ? count : 0);
        return {
          // Reuses the front of the previous array — so downstream sees the same detection.
          out: previous.out
            .slice(0, keep)
            .concat(doubled(data.slice(data.length - count))),
        };
      },
    });
    return { counts, wire, node };
  }

  it("a read after a tick runs the full calc zero times — the answer is unchanged", () => {
    const { counts, wire, node } = counted();
    counts.full = 0;

    wire.replaceLast({ x: 2, y: 30 });
    const afterReplace = node.out.out.read();
    wire.append({ x: 3, y: 4 });
    const afterAppend = node.out.out.read();

    expect(counts.full).toBe(0);
    expect(counts.tail).toBe(2);
    expect(afterReplace.map((p) => p.y)).toEqual([2, 4, 60]);
    expect(afterAppend.map((p) => p.y)).toEqual([2, 4, 60, 8]);
  });

  it("falls back to the full calc when calcLast returns null", () => {
    const counts = { full: 0 };
    const wire = feed([{ x: 0, y: 1 }, { x: 1, y: 2 }]);
    const node = computation({
      inputs: [wire.source],
      calc: (data) => {
        counts.full += 1;
        return { out: doubled(data) };
      },
      calcLast: () => null, // a shape the checkpoint can't handle — the escape hatch
    });
    counts.full = 0;

    wire.replaceLast({ x: 1, y: 20 });

    expect(node.out.out.read().map((p) => p.y)).toEqual([2, 40]);
    expect(counts.full).toBe(1);
  });

  it("a non-tail change (replacing the front) runs the full calc", () => {
    const counts = { full: 0, tailCalls: 0 };
    const wire = feed([{ x: 0, y: 1 }, { x: 1, y: 2 }]);
    let data = wire.source.read();
    const node = computation({
      inputs: [wire.source],
      calc: (input) => {
        counts.full += 1;
        return { out: doubled(input) };
      },
      calcLast: (previous) => {
        counts.tailCalls += 1;
        return previous;
      },
    });
    counts.full = 0;

    // Touches the front — the shape of a prepend. If the tail path fired here, the answer would be wrong.
    data = [{ x: -1, y: 9 }, ...data];
    (wire.source as { read: () => typeof data }).read = () => data;

    expect(node.out.out.read().map((p) => p.y)).toEqual([18, 2, 4]);
    expect(counts.full).toBe(1);
    expect(counts.tailCalls).toBe(0);
  });
});
