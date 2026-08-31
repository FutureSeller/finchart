/**
 * The bar-index mapping's head fast path — a prepend must not pay a full
 * re-merge, and must never be mistaken for a tail append.
 *
 * The channel is the same one the tail uses: an entry grows the same xs
 * array in place, so identity plus length says "grew" — and the front
 * value says on which end. The one thing this file exists to nail down is
 * the swallow landmine: a front-grown array whose shifted tail happens to
 * repeat the old maximum satisfies the tail test's shape, and the "new
 * tail" then dedupes into nothing — the prepended bar silently vanishes
 * from the index.
 */
import { describe, expect, it } from "vitest";
import { LinearScale } from "../linear-scale";
import { barIndexX } from "../x-mapping";

function counting() {
  const probe = { fullRebuilds: 0, onFullRebuild: () => void probe.fullRebuilds++ };
  return probe;
}

function mapping() {
  const probe = counting();
  const scale = new LinearScale();
  scale.setRange(0, 800);
  const map = barIndexX(scale, probe);
  const rebuild = map.rebuild;
  if (rebuild === undefined) throw new Error("barIndexX must expose rebuild");
  return { probe, map, rebuild };
}

/** Grows `xs` at the front in place — the entry-side idiom under test. */
function growHead(xs: number[], head: number[]): void {
  const old = xs.length;
  xs.length = old + head.length;
  for (let i = old - 1; i >= 0; i--) xs[i + head.length] = xs[i];
  for (let i = 0; i < head.length; i++) xs[i] = head[i];
}

const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let x = from; x < to; x++) out.push(x);
  return out;
};

/** The oracle: distinct union, ascending — index deltas must match ranks. */
function expectIndexed(map: ReturnType<typeof mapping>["map"], sorted: number[]): void {
  const distinct = [...new Set(sorted)];
  const origin = map.toDomain(distinct[0]);
  // A present bar's domain value is an integer rank — an extrapolated
  // (missing) value only lands on one by coincidence, so the integer
  // check is what catches a swallowed bar under uniform spacing.
  expect(Number.isInteger(origin), `origin rank of ${distinct[0]}`).toBe(true);
  for (let i = 0; i < distinct.length; i++) {
    expect(map.toDomain(distinct[i]), `rank of ${distinct[i]}`).toBe(origin + i);
    expect(map.fromDomain(origin + i), `x at rank ${i}`).toBe(distinct[i]);
  }
}

describe("bar-index head fast path", () => {
  it("should extend at the head without a full re-merge, keeping old indices", () => {
    const { probe, map, rebuild } = mapping();
    const xs = range(100, 200);
    rebuild([xs]);
    const walks = probe.fullRebuilds;
    const anchorIndex = map.toDomain(100);

    growHead(xs, range(90, 100));
    rebuild([xs]);

    expect(probe.fullRebuilds).toBe(walks);
    // The bars already on screen keep their indices — that's what holds
    // the viewport still while history lands.
    expect(map.toDomain(100)).toBe(anchorIndex);
    expect(map.toDomain(90)).toBe(anchorIndex - 10);
    expectIndexed(map, range(90, 200));
  });

  it("should not swallow a one-bar prepend whose shifted tail repeats the old maximum", () => {
    const { map, rebuild } = mapping();
    // Tail ends in a duplicate run — after a front insertion the shifted
    // region satisfies the tail test's value condition exactly. Spacing
    // is non-uniform on purpose: with uniform bars, linear extrapolation
    // of the missing value happens to land on the right answer and hides
    // the swallow.
    const xs = [100, 103, 107, 107];
    rebuild([xs]);

    growHead(xs, [95]);
    rebuild([xs]);

    expectIndexed(map, [95, 100, 103, 107]);
  });

  it("should take head and tail growth on different sources in one rebuild", () => {
    const { probe, map, rebuild } = mapping();
    const a = range(100, 150);
    const b = range(100, 150);
    rebuild([a, b]);
    const walks = probe.fullRebuilds;

    growHead(a, range(95, 100)); // history landed on a
    b.push(150, 151); // ticks landed on b
    rebuild([a, b]);

    expect(probe.fullRebuilds).toBe(walks);
    expectIndexed(map, range(95, 152));
  });

  it("should merge and dedupe overlapping heads from several sources", () => {
    const { probe, map, rebuild } = mapping();
    const a = range(100, 150);
    const b = range(100, 150);
    rebuild([a, b]);
    const walks = probe.fullRebuilds;

    growHead(a, range(90, 100));
    growHead(b, range(94, 100));
    rebuild([a, b]);

    expect(probe.fullRebuilds).toBe(walks);
    expectIndexed(map, range(90, 150));
  });

  it("should merge a head that interleaves territory another source already covers", () => {
    const { probe, map, rebuild } = mapping();
    const a = range(100, 150);
    const b = range(120, 150);
    rebuild([a, b]);
    const walks = probe.fullRebuilds;

    // b's new head lands inside a's territory — landings arrive per
    // handle, so the front merge has to absorb overlap, not bail on it.
    growHead(b, range(110, 120));
    rebuild([a, b]);

    expect(probe.fullRebuilds).toBe(walks);
    expectIndexed(map, range(100, 150));
  });

  it("should take per-handle sequential landings — the second head overlaps the widened front", () => {
    const { probe, map, rebuild } = mapping();
    const a = range(100, 150);
    const b = range(100, 150);
    rebuild([a, b]);
    const walks = probe.fullRebuilds;

    growHead(a, range(90, 100));
    rebuild([a, b]); // a landed, b hasn't yet — mid-landing render
    growHead(b, range(90, 100));
    rebuild([a, b]);

    expect(probe.fullRebuilds).toBe(walks);
    expectIndexed(map, range(90, 150));
  });

  it("should fall back when the array identity changes — a swapped dataset is a new world", () => {
    const { probe, map, rebuild } = mapping();
    const xs = range(100, 200);
    rebuild([xs]);
    const walks = probe.fullRebuilds;

    rebuild([range(90, 200)]);
    expect(probe.fullRebuilds).toBe(walks + 1);
    expectIndexed(map, range(90, 200));
  });

  it("should keep an equal-x seam between head and old front to one bar", () => {
    const { map, rebuild } = mapping();
    const xs = [100, 104, 109, ...range(110, 150)];
    rebuild([xs]);

    growHead(xs, [93, 97, 100]); // the page carries the boundary bar
    rebuild([xs]);

    expectIndexed(map, [93, 97, 100, 104, 109, ...range(110, 150)]);
  });
});
