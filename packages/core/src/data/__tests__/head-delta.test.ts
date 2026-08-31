/**
 * `headDelta` — classifies "grew at the front" from point-object identity,
 * the same channel `tailDelta` reads. A prepend under `calcFirst`'s output
 * rule reuses the previous array's tail beyond the corrected zone, so the
 * shift and the zone's width can both be recovered from identities alone.
 *
 * The discipline is tailDelta's: the entire reused range is checked, not
 * a sample — a swap hiding mid-array must come back null, never a wrong
 * classification.
 */
import { describe, expect, it } from "vitest";
import { headDelta } from "../head-delta";

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i }));

describe("headDelta", () => {
  it("classifies a pure prepend — every old object present, shifted", () => {
    const previous = points(10);
    const next = [...points(3).map((p) => ({ x: p.x - 3 })), ...previous];
    expect(headDelta(previous, next)).toEqual({ kind: "prepend", count: 3, corrected: 0 });
  });

  it("classifies a prepend with a corrected zone — fresh objects at the old head", () => {
    const previous = points(10);
    const corrected = previous.slice(0, 4).map((p) => ({ x: p.x }));
    const next = [
      ...points(5).map((p) => ({ x: p.x - 5 })),
      ...corrected,
      ...previous.slice(4),
    ];
    expect(headDelta(previous, next)).toEqual({ kind: "prepend", count: 5, corrected: 4 });
  });

  it("returns null when nothing of the old array survives", () => {
    const previous = points(10);
    const next = points(15).map((p) => ({ x: p.x - 5 }));
    expect(headDelta(previous, next)).toBeNull();
  });

  it("returns null on a swap hiding mid-array — the whole reused range is checked", () => {
    const previous = points(10);
    const next = [{ x: -1 }, ...previous.slice(0, 5), { x: 5 }, ...previous.slice(6)];
    expect(headDelta(previous, next)).toBeNull();
  });

  it("returns null when the array shrank or matched in length", () => {
    const previous = points(10);
    expect(headDelta(previous, previous.slice(1))).toBeNull();
    expect(headDelta(previous, [...previous])).toBeNull();
    expect(headDelta([], points(3))).toBeNull();
  });

  it("returns null when the tail object differs — that is not a landing", () => {
    const previous = points(10);
    const next = [{ x: -1 }, ...previous.slice(0, 9), { x: 9 }];
    expect(headDelta(previous, next)).toBeNull();
  });
});
