import { describe, expect, it } from "vitest";
import { mergeByX } from "../merge-by-x";

interface P {
  x: number;
  v: string;
}
const p = (x: number, v = `${x}`): P => ({ x, v });
const getX = (point: P) => point.x;
const xs = (points: readonly P[]) => points.map((point) => point.x);
const vs = (points: readonly P[]) => points.map((point) => point.v);

describe("mergeByX — the x keys are the union, the named ones are the incoming's", () => {
  it("replaces what it names and keeps what it does not", () => {
    const held = [1, 2, 3, 4, 5, 6].map((x) => p(x));
    const { points, start } = mergeByX(held, [p(4, "4′"), p(6, "6′")], getX);

    expect(vs(points)).toEqual(["1", "2", "3", "4′", "5", "6′"]);
    expect(start).toBe(3);
  });

  it("keeps the held points that lie beyond what it names", () => {
    const held = Array.from({ length: 10 }, (_, i) => p(i + 1));
    const { points } = mergeByX(held, [p(4, "4′"), p(5, "5′"), p(6, "6′")], getX);

    expect(vs(points)).toEqual(["1", "2", "3", "4′", "5′", "6′", "7", "8", "9", "10"]);
  });

  it("puts an x it did not hold where it belongs — between, or after the end", () => {
    const held = [1, 3, 5].map((x) => p(x));
    expect(xs(mergeByX(held, [p(2), p(4), p(9)], getX).points)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(xs(mergeByX(held, [p(6), p(7)], getX).points)).toEqual([1, 3, 5, 6, 7]);
    // Before the first as well — the helper is a union; whether a door
    // allows that is the door's policy, not the merge's.
    expect(xs(mergeByX(held, [p(0)], getX).points)).toEqual([0, 1, 3, 5]);
  });

  /**
   * Where x is not unique a key holds a run, and a run is replaced whole:
   * the held `[4a, 4b]` is not paired with the incoming `[4c, 4d, 4e]`
   * one to one, it is gone and they are there.
   */
  it("replaces a whole run at an x with the whole incoming run at it", () => {
    const held = [p(4, "4a"), p(4, "4b"), p(6)];
    expect(vs(mergeByX(held, [p(4, "4c"), p(4, "4d"), p(4, "4e")], getX).points)).toEqual(["4c", "4d", "4e", "6"]);
    expect(vs(mergeByX([p(4, "4a"), p(4, "4b"), p(4, "4c")], [p(4, "4′")], getX).points)).toEqual(["4′"]);
  });

  it("keeps the object identity of every held point outside the runs it replaces", () => {
    const held = [1, 2, 3, 4, 5].map((x) => p(x));
    const { points, start } = mergeByX(held, [p(3, "3′"), p(4, "4′")], getX);

    expect(points[0]).toBe(held[0]);
    expect(points[1]).toBe(held[1]);
    expect(points[4]).toBe(held[4]);
    expect(start).toBe(2);
  });

  it("does nothing with nothing, and says the held array is unchanged throughout", () => {
    const held = [p(1), p(2)];
    const { points, start } = mergeByX(held, [], getX);

    expect(points).toEqual(held);
    expect(points).not.toBe(held);
    expect(start).toBe(2);
  });

  /**
   * A `NaN` x is a precondition violation — the doors refuse it before it
   * gets here — but a pure function has to finish on any input, and one
   * that compared `NaN` to itself to decide when to move on never did.
   */
  it("finishes even on an x that is not a number", () => {
    const held = [p(1), { x: Number.NaN, v: "?" }, p(4)];
    const { points } = mergeByX(held, [p(4, "4′")], getX);

    // What it holds after is nobody's promise; that it returned is.
    expect(points.length).toBeGreaterThan(0);
    expect(vs(points)).toContain("4′");
  });

  it("merges into an empty held array as a copy of the incoming", () => {
    const incoming = [p(1), p(2)];
    const { points, start } = mergeByX([], incoming, getX);

    expect(points).toEqual(incoming);
    expect(start).toBe(0);
  });
});
