import { describe, expect, it } from "vitest";
import { LinearScale } from "../linear-scale";
import { barIndexX, continuousX } from "../x-mapping";

describe("continuousX", () => {
  it("should pass x straight through the scale", () => {
    const mapping = continuousX(new LinearScale(0, 100, 0, 800));

    expect(mapping.toPixel(50)).toBe(400);
    expect(mapping.fromPixel(400)).toBe(50);
  });

  it("should treat domain and data x as the same space", () => {
    const mapping = continuousX(new LinearScale(0, 100, 0, 800));

    expect(mapping.toDomain(37)).toBe(37);
    expect(mapping.fromDomain(37)).toBe(37);
  });

  it("should have nothing to rebuild", () => {
    expect(continuousX(new LinearScale()).rebuild).toBeUndefined();
  });
});

describe("barIndexX", () => {
  /** 5 bars with a gap between Friday and Monday: indices are 0,1,2,3,4. */
  const weekWithGap = [0, 1, 2, 5, 6];

  const mounted = (xs: number[] = weekWithGap) => {
    // The domain is index space. 5 bars -> indices 0-4 spread over 0-400px.
    const scale = new LinearScale(0, 4, 0, 400);
    const mapping = barIndexX(scale);
    mapping.rebuild?.([xs]);
    return { scale, mapping };
  };

  describe("uniform placement", () => {
    it("should place bars one slot apart regardless of x gaps", () => {
      const { mapping } = mounted();

      // The weekend gap (2 -> 5) doesn't open up on screen — every neighbor is 100px apart.
      const px = weekWithGap.map((x) => mapping.toPixel(x));
      expect(px).toEqual([0, 100, 200, 300, 400]);
    });

    it("should give each bar its position as the domain value", () => {
      const { mapping } = mounted();

      expect(mapping.toDomain(0)).toBe(0);
      expect(mapping.toDomain(2)).toBe(2);
      expect(mapping.toDomain(6)).toBe(4);
    });
  });

  describe("between and beyond bars", () => {
    it("should split the slot between neighboring bars linearly", () => {
      const { mapping } = mounted();

      // 3.5, between 2 and 5, is halfway through that slot.
      expect(mapping.toDomain(3.5)).toBe(2.5);
      expect(mapping.fromDomain(2.5)).toBe(3.5);
    });

    it("should extrapolate past the edges with the edge gap", () => {
      const { mapping } = mounted();

      // Off the left edge: extends using the first gap (1). Off the right edge: uses the last gap (1).
      expect(mapping.toDomain(-2)).toBe(-2);
      expect(mapping.toDomain(8)).toBe(6);
      expect(mapping.fromDomain(-2)).toBe(-2);
      expect(mapping.fromDomain(6)).toBe(8);
    });

    it("should round trip through pixels", () => {
      const { mapping } = mounted();

      for (const x of [0, 1, 3.5, 6, -1, 9]) {
        expect(mapping.fromPixel(mapping.toPixel(x))).toBeCloseTo(x, 10);
      }
    });
  });

  describe("rebuild", () => {
    it("should keep existing indices when older bars are prepended", () => {
      const { mapping } = mounted([10, 11, 12]);
      expect(mapping.toDomain(10)).toBe(0);

      // 3 older bars get prepended — the anchor bar's (10) index stays put.
      mapping.rebuild?.([[7, 8, 9, 10, 11, 12]]);

      expect(mapping.toDomain(10)).toBe(0);
      expect(mapping.toDomain(12)).toBe(2);
      // The newly prepended bars extend into negative indices.
      expect(mapping.toDomain(7)).toBe(-3);
    });

    it("should keep indices when newer bars are appended", () => {
      const { mapping } = mounted([10, 11, 12]);

      mapping.rebuild?.([[10, 11, 12, 13, 14]]);

      expect(mapping.toDomain(10)).toBe(0);
      expect(mapping.toDomain(14)).toBe(4);
    });

    it("should restart from zero when the dataset is replaced", () => {
      const { mapping } = mounted([10, 11, 12]);

      // The anchor bar is gone — since setData refits anyway, indices start over.
      mapping.rebuild?.([[100, 101, 102]]);

      expect(mapping.toDomain(100)).toBe(0);
    });

    it("should merge the union of all registrations", () => {
      const { mapping } = mounted();

      // Two series each hold half the bars and share x=2 — the union is the index space.
      mapping.rebuild?.([
        [0, 2, 4],
        [1, 2, 3],
      ]);

      expect([0, 1, 2, 3, 4].map((x) => mapping.toDomain(x))).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });

    it("should forget the origin when all data is gone", () => {
      const { mapping } = mounted([10, 11, 12]);

      mapping.rebuild?.([]);
      mapping.rebuild?.([[50, 51]]);

      expect(mapping.toDomain(50)).toBe(0);
    });
  });

  describe("degenerate data", () => {
    it("should fall back to identity before any data", () => {
      const mapping = barIndexX(new LinearScale(0, 4, 0, 400));

      expect(mapping.toDomain(7)).toBe(7);
      expect(mapping.fromDomain(7)).toBe(7);
    });

    it("should count in x units around a single bar", () => {
      const { mapping } = mounted([10]);

      // With no gap known, one unit of x counts as one slot.
      expect(mapping.toDomain(10)).toBe(0);
      expect(mapping.toDomain(11)).toBe(1);
      expect(mapping.toDomain(8)).toBe(-2);
      expect(mapping.fromDomain(0)).toBe(10);
      expect(mapping.fromDomain(1)).toBe(11);
      expect(mapping.scanToDomain?.()(11)).toBe(1);
      expect(Number.isFinite(mapping.toPixel(11))).toBe(true);
    });

    it("should collapse duplicate x into one bar", () => {
      const { mapping } = mounted([1, 1, 2]);

      expect(mapping.toDomain(2)).toBe(1);
    });
  });
});

/**
 * The union of several sorted slices. Using a cursor sweep instead of
 * `sources.flat().sort()` relies on the fact that each registration is
 * already sorted — ascending x is the data contract. It has to preserve
 * all three things sorting
 * used to guarantee: ascending order, dedup within a series, and dedup
 * across series.
 */
describe("x union across multiple series", () => {
  /** Give the domain plenty of room so indices can be read off directly. */
  const merged = (sources: number[][]) => {
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000));
    mapping.rebuild?.(sources);
    return mapping;
  };

  it("merges interleaved series into ascending order", () => {
    const mapping = merged([
      [0, 10, 20],
      [5, 15, 25],
    ]);

    // 0,5,10,15,20,25 -> six slots.
    expect(mapping.toDomain(0)).toBe(0);
    expect(mapping.toDomain(5)).toBe(1);
    expect(mapping.toDomain(25)).toBe(5);
  });

  it("collapses a value shared across series into one slot", () => {
    // An indicator shares its x values with the source series — the most common wiring.
    const mapping = merged([
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      [2, 3],
    ]);

    expect(mapping.toDomain(3)).toBe(3);
    expect(mapping.fromDomain(3)).toBe(3);
  });

  it("collapses duplicates within a single series too", () => {
    const mapping = merged([[0, 0, 1, 1, 2]]);

    expect(mapping.toDomain(2)).toBe(2);
  });

  /**
   * Two or more series, each with internal duplicates. The contract allows
   * a repeated x for line data ("two points can share one timestamp" —
   * `DataManager`; bars declare `uniqueX` and reject it).
   * A single series takes the fast path, so this combination is needed to
   * actually exercise the merge loop's duplicate handling.
   */
  it("collapses to one slot each even with multiple series that each have duplicates", () => {
    const mapping = merged([
      [0, 0, 1, 2, 2],
      [1, 1, 3],
    ]);

    // 0,1,2,3 -> four slots.
    expect(mapping.toDomain(3)).toBe(3);
    expect(mapping.fromDomain(2)).toBe(2);
  });

  it("gives the same answer whether empty series are mixed in or not", () => {
    const withEmpty = merged([[], [0, 1, 2], []]);
    const without = merged([[0, 1, 2]]);

    expect(withEmpty.toDomain(2)).toBe(without.toDomain(2));
  });

  it("has no bars to count when everything is empty", () => {
    const mapping = merged([[], []]);

    // Same as before any data — falls back to identity.
    expect(mapping.toDomain(42)).toBe(42);
  });
});

/**
 * A scan pass must not change the answer, and passes must not interfere with
 * each other. Back when the cursor was shared across one mapping, "what did
 * we ask yesterday" would fork the code path — tests protected the answer
 * being the same, but nothing in the structure guaranteed it. Now `toDomain`
 * is pure and the cursor belongs to whichever pass `scanToDomain()` opened.
 * What's checked here are that structure's three promises: any query order
 * matches the pure answer, passes are independent of each other, and a
 * rebuild mid-pass doesn't blow up.
 */
describe("scanToDomain", () => {
  const xs = [0, 1, 2, 5, 6, 10, 11, 12, 20, 40, 100];
  const mounted = () => {
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000));
    mapping.rebuild?.([xs]);
    return mapping;
  };

  it("an ascending pass matches the pure toDomain", () => {
    const mapping = mounted();
    const scan = mapping.scanToDomain?.();

    for (const x of xs) {
      expect(scan?.(x)).toBe(mapping.toDomain(x));
    }
  });

  it("still matches with the order shuffled, including values between bars", () => {
    const mapping = mounted();
    const scan = mapping.scanToDomain?.();

    for (const x of [100, 0, 7.5, 40, 1, 20, 3.2, 11]) {
      expect(scan?.(x)).toBe(mapping.toDomain(x));
    }
  });

  /**
   * Independence between passes — with a shared cursor hint, interleaving
   * two scans would trample each other's cursor, and the resulting
   * backtracking blew up thousands of times per frame. Now there's no way
   * for one pass to even know the other exists.
   */
  it("interleaving two passes doesn't change either one's answers", () => {
    const mapping = mounted();
    const a = mapping.scanToDomain?.();
    const b = mapping.scanToDomain?.();

    for (let i = 0; i < xs.length; i++) {
      // a walks forward, b walks backward — they alternate every step.
      expect(a?.(xs[i])).toBe(mapping.toDomain(xs[i]));
      const fromBack = xs[xs.length - 1 - i];
      expect(b?.(fromBack)).toBe(mapping.toDomain(fromBack));
    }
  });

  /**
   * After a step of two bars the pass first looks two bars ahead — from
   * x = 2 that is 6, which sits past 3, but so does 5 before it. The
   * answer has to come from the bar 3 actually lands before.
   */
  it("matches toDomain for a query that falls short of the last step's stride", () => {
    const mapping = mounted();
    const scan = mapping.scanToDomain?.();

    scan?.(0);
    scan?.(2);
    expect(scan?.(3)).toBe(mapping.toDomain(3));
  });

  it("a rebuild mid-pass answers against the new list", () => {
    const mapping = mounted();
    const scan = mapping.scanToDomain?.();
    scan?.(100); // push the cursor to the end of the list.

    mapping.rebuild?.([[0, 1, 2]]);

    expect(scan?.(2)).toBe(mapping.toDomain(2));
    expect(scan?.(0)).toBe(mapping.toDomain(0));
  });

  it("only reports a backtrack that crosses the window — a far forward jump and an in-window backtrack are both still a scan", () => {
    let fallbacks = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFallback: () => {
        fallbacks += 1;
      },
    });
    // Sized so it can cross the window (32 slots) in either direction — this
    // is the shape of a real-world stride: a drawing pass's forward jump is
    // the decimation stride (data/screen ratio), which can exceed the window.
    const many = Array.from({ length: 500 }, (_, i) => i * 2);
    mapping.rebuild?.([many]);
    const scan = mapping.scanToDomain?.();

    // Forward within the limit (32 slots) is reachable by walking — nothing to report.
    scan?.(40);
    expect(fallbacks).toBe(0);

    // A forward jump past the window is still monotonic, so it's still a scan
    // — it gallops to catch up and the answer matches the pure toDomain.
    expect(scan?.(700)).toBe(mapping.toDomain(700));
    expect(fallbacks).toBe(0);

    // A backtrack inside the window (mixed order within an M4 bucket) stays near the cursor — it walks quietly.
    expect(scan?.(660)).toBe(mapping.toDomain(660));
    expect(fallbacks).toBe(0);

    // A backtrack that crosses the window is not a scan — it reports and searches from scratch.
    expect(scan?.(0)).toBe(mapping.toDomain(0));
    expect(fallbacks).toBe(1);
  });

  it("the pure toDomain has no pass, so there's nothing to report", () => {
    let fallbacks = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFallback: () => {
        fallbacks += 1;
      },
    });
    mapping.rebuild?.([xs]);

    // Any query order — with no state, there's no cursor to backtrack at all.
    for (const x of [100, 0, 40, 1]) mapping.toDomain(x);
    expect(fallbacks).toBe(0);
  });
});

/**
 * The tail fast path of a rebuild — identity is the notification. An
 * entry's xs cache grows the same array in place, so a rebuild can tell a
 * tail append apart by identity + length. What has to hold: the fast path's
 * answer matches a full walk, and every case that should fall through (a
 * new array, shrinkage, a violation of global order) falls back to a full
 * rebuild.
 */
describe("tail fast path of a rebuild", () => {
  const fresh = (sources: number[][]) => {
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000));
    mapping.rebuild?.(sources);
    return mapping;
  };

  it("a source grown in place matches a full walk", () => {
    let fulls = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFullRebuild: () => {
        fulls += 1;
      },
    });
    const a = [0, 2, 4];
    const b = [1, 2, 3];
    mapping.rebuild?.([a, b]);
    expect(fulls).toBe(1);

    // A new bar — both sources push the same x in place (the shape of extendXs).
    a.push(5);
    b.push(5);
    mapping.rebuild?.([a, b]);
    expect(fulls).toBe(1); // fast path

    const expected = fresh([a.slice(), b.slice()]);
    for (const x of [0, 1, 2, 3, 4, 5, 2.5]) {
      expect(mapping.toDomain(x)).toBe(expected.toDomain(x));
    }
  });

  it("matches whether only one source grows or several grow together", () => {
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000));
    const a = [0, 1, 2];
    const b = [0, 1, 2];
    mapping.rebuild?.([a, b]);

    a.push(3); // b stays put — the shape of an indicator lagging one tick behind
    mapping.rebuild?.([a, b]);
    b.push(3);
    b.push(4);
    a.push(4);
    mapping.rebuild?.([a, b]);

    const expected = fresh([a.slice(), b.slice()]);
    for (const x of [0, 3, 4, 3.5]) {
      expect(mapping.toDomain(x)).toBe(expected.toDomain(x));
    }
  });

  it("a new array forces a full walk — the shape of prepend/setData", () => {
    let fulls = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFullRebuild: () => {
        fulls += 1;
      },
    });
    const a = [5, 6, 7];
    mapping.rebuild?.([a]);

    // prepend — a **new array** with a different front. If the fast path
    // swallowed this, the newly prepended bars would never get an index.
    const grown = [3, 4, 5, 6, 7];
    mapping.rebuild?.([grown]);
    expect(fulls).toBe(2);
    // Anchor semantics: the existing bar (x=5) keeps index 0 and the past
    // extends into negative indices — don't compare against a fresh mapping
    // (that one has no anchor).
    expect(mapping.toDomain(5)).toBe(0);
    expect(mapping.toDomain(3)).toBe(-2);
  });

  it("a mapping grown from an empty source also sets an anchor — a prepend doesn't shift the index", () => {
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000));

    // Registered, but no data yet — the first rebuild with an empty source.
    const xs: number[] = [];
    mapping.rebuild?.([xs]);

    // Bars arrive by streaming — extendXs's in-place growth = the tail fast path.
    xs.push(5, 6, 7);
    mapping.rebuild?.([xs]);
    expect(mapping.toDomain(5)).toBe(0);

    // Backfilling the past — prepend is a new array, so it's a full walk. If
    // the fast path hadn't set the anchor, indices would restart from 0 here
    // and the screen would jump into the past.
    mapping.rebuild?.([[3, 4, 5, 6, 7]]);
    expect(mapping.toDomain(5)).toBe(0);
    expect(mapping.toDomain(3)).toBe(-2);
  });

  it("falls back to a full rebuild when a source is rewritten in place at the same length", () => {
    let fulls = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFullRebuild: () => {
        fulls += 1;
      },
    });
    const xs = [0, 2, 4];
    mapping.rebuild?.([xs]);

    // Same identity, same length, a different front.
    xs[0] = 1;
    mapping.rebuild?.([xs]);

    expect(fulls).toBe(2);
    const expected = fresh([[1, 2, 4]]);
    for (const x of [1, 1.5, 2, 4]) {
      expect(mapping.toDomain(x)).toBe(expected.toDomain(x));
    }
  });

  it("falls back to a full rebuild when the appended value is below the existing max", () => {
    let fulls = 0;
    const mapping = barIndexX(new LinearScale(0, 10, 0, 1000), {
      onFullRebuild: () => {
        fulls += 1;
      },
    });
    const a = [0, 5];
    const b = [0, 9];
    mapping.rebuild?.([a, b]);

    a.push(7); // below b's max (9) — not a tail append in global order.
    mapping.rebuild?.([a, b]);
    expect(fulls).toBe(2);
    expect(mapping.toDomain(7)).toBe(fresh([a.slice(), b.slice()]).toDomain(7));
  });
});

it("interpolates the entire finite x interval including exact endpoints", () => {
  const mapping = barIndexX(new LinearScale(0, 1, 0, 100));
  const max = Number.MAX_VALUE;
  mapping.rebuild?.([[-max, max]]);
  expect(mapping.toDomain(0)).toBe(0.5);
  expect(mapping.fromDomain(0)).toBe(-max);
  expect(mapping.fromDomain(1)).toBe(max);
  expect(mapping.fromDomain(0.5)).toBe(0);
  expect(mapping.toPixel(0)).toBe(50);
  const scan = mapping.scanToDomain?.();
  for (const x of [-max, -max / 2, 0, max / 2, max]) {
    expect(scan?.(x)).toBe(mapping.toDomain(x));
    expect(mapping.fromDomain(mapping.toDomain(x)) / max).toBeCloseTo(x / max, 14);
  }
});

it("keeps exact mapping and scale endpoints when their magnitudes differ", () => {
  const mapping = barIndexX(new LinearScale(0, 1, 0, 100));
  mapping.rebuild?.([[-1e16, 1]]);
  expect(mapping.fromDomain(1)).toBe(1);
  expect(mapping.fromPixel(100)).toBe(1);
  expect(mapping.fromDomain(1 + Number.EPSILON)).toBe(1 + Number.EPSILON * 1e16);
  const scale = new LinearScale(-1e16, 1, 0, 100);
  expect(scale.invert(100)).toBe(1);
  expect(scale.invert(0)).toBe(-1e16);
});
