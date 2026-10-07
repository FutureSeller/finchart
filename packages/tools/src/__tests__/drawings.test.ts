import { describe, expect, it } from "vitest";
import { ContractError } from "@finchart/core";
import { parseDrawings, serializeDrawings, type Drawing, channelParallel, fibExtensionPrice, fibLevelPrice, pitchforkLines } from "../drawings";
import { distanceToPoint, distanceToSegment } from "../geometry";

describe("serialization", () => {
  const drawings: Drawing[] = [
    { type: "horizontal", id: "h1", price: 104_500 },
    { type: "trend", id: "t1", a: { x: 3, price: 100 }, b: { x: 9, price: 130 } },
    { type: "fib", id: "f1", a: { x: 1, price: 90 }, b: { x: 7, price: 140 } },
  ];

  it("should round-trip", () => {
    expect(parseDrawings(serializeDrawings(drawings))).toEqual(drawings);
  });

  /**
   * Only the current format is read. Nothing was ever published in an
   * earlier one, so an old `version` is refused like any unknown one.
   */
  it("refuses a version-1 payload", () => {
    expect(parseDrawings('{"version":1,"drawings":[{"type":"horizontal","price":105}]}')).toBeNull();
  });

  /** From the day v2 ships, this string is read forever — pinned as a literal so a serializer and parser changed together cannot hide a break. */
  it("a frozen v2 payload is read forever", () => {
    const savedByV2 =
      '{"version":2,"drawings":[{"type":"horizontal","id":"h1","price":105},{"type":"trend","id":"t1","a":{"x":3,"price":100},"b":{"x":9,"price":110}}]}';

    expect(parseDrawings(savedByV2)).toEqual([
      { type: "horizontal", id: "h1", price: 105 },
      { type: "trend", id: "t1", a: { x: 3, price: 100 }, b: { x: 9, price: 110 } },
    ]);
  });

  it("should refuse an unknown version instead of guessing", () => {
    const payload = JSON.stringify({ version: 999, drawings });

    expect(parseDrawings(payload)).toBeNull();
  });

  it("should refuse garbage without throwing", () => {
    expect(parseDrawings("not json")).toBeNull();
    expect(parseDrawings('{"version":1}')).toBeNull();
    expect(
      parseDrawings('{"version":1,"drawings":[{"type":"horizontal"}]}'),
    ).toBeNull();
    expect(
      parseDrawings('{"version":1,"drawings":[{"type":"mystery","price":1}]}'),
    ).toBeNull();
    // v2 requires an id — a payload without one is not ours.
    expect(
      parseDrawings('{"version":2,"drawings":[{"type":"horizontal","price":1}]}'),
    ).toBeNull();
    expect(
      parseDrawings(
        '{"version":2,"drawings":[{"type":"horizontal","id":"","price":1}]}',
      ),
    ).toBeNull();
  });
});

/**
 * Round-trip loss is a POLICY, not a bug (ADR-0047): the normalizer
 * drops fields it doesn't know, so a payload written by a future v2.x
 * loses that field when an older v2 client round-trips it. This pin is
 * here so the next person can tell policy from unimplemented — if you
 * came to make unknown fields survive, you are changing ADR-0047, and
 * this test going red is it telling you so.
 */
it("round-trip loss is policy — a future optional field drops, knowingly", () => {
  const fromNewerV2 =
    '{"version":2,"drawings":[{"type":"horizontal","id":"h1","price":1,"futureField":"from-v2.9"}]}';
  const back = parseDrawings(fromNewerV2);
  expect(back).toEqual([{ type: "horizontal", id: "h1", price: 1 }]);
  expect(serializeDrawings(back ?? [])).not.toContain("futureField");
});

describe("ids", () => {
  /**
   * A duplicate in a consumer's array is their store's key clashing —
   * silently reissuing it would rewire their store behind their back, so
   * the input API throws (the same policy as every other unfit input).
   */
  it("serialize refuses two drawings with the same id", () => {
    const twins: Drawing[] = [
      { type: "horizontal", id: "dup", price: 100 },
      { type: "horizontal", id: "dup", price: 110 },
    ];
    expect(() => serializeDrawings(twins)).toThrow(ContractError);
  });

  /**
   * A duplicate in a *payload* is a repairable defect — the geometry is
   * intact, only the name tags clash. The reissue is deterministic, so
   * the same payload parses to the same ledger twice.
   */
  it("parse repairs duplicate ids deterministically instead of dropping the ledger", () => {
    const payload =
      '{"version":2,"drawings":[{"type":"horizontal","id":"dup","price":100},{"type":"horizontal","id":"dup","price":110},{"type":"horizontal","id":"dup#2","price":120}]}';

    const first = parseDrawings(payload);
    expect(first).not.toBeNull();
    const ids = (first ?? []).map((drawing) => drawing.id);
    // All unique. First occurrence keeps its name, and so does the
    // drawing that legitimately owned "dup#2" — the reissue dodges every
    // id in the envelope, so it can't steal a later owner's name.
    expect(ids).toEqual(["dup", "dup#3", "dup#2"]);
    expect(parseDrawings(payload)).toEqual(first);
  });
});

describe("distanceToSegment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it("should drop a perpendicular inside the segment", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
  });

  it("should clamp to the nearest endpoint outside", () => {
    expect(distanceToSegment({ x: 14, y: 3 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5);
  });

  it("should treat a zero-length segment as a point", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  it("should measure zero for a point sitting on a zero-length segment", () => {
    expect(distanceToSegment(a, a, a)).toBe(0);
  });

  /** The anchors' span leaves the doubles, but the distance itself is an ordinary 1e308. */
  it("should keep an exact perpendicular when the anchors' span overflows", () => {
    expect(distanceToSegment({ x: 0, y: 1e308 }, { x: -1e308, y: 0 }, { x: 1e308, y: 0 })).toBe(1e308);
  });

  /** A missing point is a false hit, never a distance from the origin. */
  it("should answer NaN for a point that is not there", () => {
    // Sent through Reflect.apply, since the type checker would refuse the missing point.
    expect(Reflect.apply(distanceToPoint, undefined, [null, a])).toBeNaN();
    expect(Reflect.apply(distanceToSegment, undefined, [null, a, b])).toBeNaN();
  });
});

/**
 * The entry and the exit check the same predicate. If only
 * `parseDrawings` checks finiteness, then when `add` accepts `NaN`
 * coordinates and saves them, the next session's `load` rejects the very
 * string it wrote itself — and because it's all-or-nothing, it loses the
 * intact drawings right along with it.
 */
describe("symmetry between entry and exit", () => {
  const nonFinite: Drawing[] = [
    { type: "horizontal", id: "x1", price: NaN },
    { type: "horizontal", id: "x2", price: JSON.parse('{"v":1e999}').v },
    { type: "trend", id: "x3", a: { x: 1, price: NaN }, b: { x: 2, price: 3 } },
    { type: "trend", id: "x4", a: { x: NaN, price: 1 }, b: { x: 2, price: 3 } },
    { type: "fib", id: "x5", a: { x: 1, price: 2 }, b: { x: JSON.parse('{"v":1e999}').v, price: 3 } },
  ];

  /**
   * The entry point rejects first — so a consumer never hits "it saved
   * fine, but the whole ledger is gone next session."
   */
  it("should reject every non-finite shape at serialization — not at load", () => {
    for (const drawing of nonFinite) {
      expect(() => serializeDrawings([drawing])).toThrow(ContractError);
    }
  });
});

it('keeps finite linear geometry when intermediate sums or differences overflow', () => {
  const a = { x: 0, price: 1e308 }, b = { x: 1, price: -1e308 };
  const fib = { type: 'fib' as const, id: 'f', a, b };
  expect(fibLevelPrice(fib, 0)).toBe(b.price);
  expect(fibLevelPrice(fib, 1)).toBe(a.price);
  expect(fibLevelPrice(fib, 0.5)).toBe(0);
  const origin = { x: 0, price: 1e16 };
  expect(fibExtensionPrice({ a: origin, b: { x: 1, price: 1 }, c: origin }, 1)).toBe(1);
  expect(channelParallel({ a, b, c: { x: 0, price: 0 } })[0].price).toBe(0);
  const fork = pitchforkLines({ a: { x: 0, price: 1e308 }, b: { x: 1, price: 1e308 }, c: { x: 3, price: 1e308 } });
  expect(fork.every((pair) => pair.every((anchor) => anchor.price === 1e308))).toBe(true);
  expect(distanceToSegment({ x: 0, y: 0 }, { x: -1e200, y: 0 }, { x: 1e200, y: 0 })).toBe(0);
  expect(distanceToSegment({ x: 1e16 + 2, y: 3 }, { x: 1e16, y: 0 }, { x: 1e16 + 4, y: 0 })).toBe(3);
});

it('keeps repaired IDs valid and avoids collisions with existing shortened IDs', () => {
  const id = 'a'.repeat(128);
  const drawings = [id, id, `${'a'.repeat(126)}#2`, id].map((id, price) => ({ type: 'horizontal', price, id }));
  const parsed = parseDrawings(JSON.stringify({ version: 2, drawings }));
  expect(parsed).not.toBeNull();
  if (!parsed) return;
  expect(new Set(parsed.map((drawing) => drawing.id)).size).toBe(4);
  expect(parsed.every((drawing) => drawing.id.length <= 128)).toBe(true);
  expect(parseDrawings(serializeDrawings(parsed))).toEqual(parsed);
  expect(parseDrawings(JSON.stringify({ version: 2, drawings }))).toEqual(parsed);
});

it('keeps an overflowing retracement level proportional to the swing', () => {
  const a = { x: 0, price: 1e308 }, b = { x: 1, price: -1e308 };
  // A quarter of the way up a swing whose height leaves the doubles.
  expect(Math.abs(fibLevelPrice({ type: 'fib', id: 'f', a, b }, 0.25) / (-a.price / 2) - 1)).toBeLessThan(1e-9);
});

it('puts every log extension level at c when the swing is flat', () => {
  expect(fibExtensionPrice({
    a: { x: 0, price: 100 },
    b: { x: 1, price: 100 },
    c: { x: 2, price: 150 },
    levelSpacing: 'log',
  }, 1.618)).toBe(150);
});

describe('stored size limits', () => {
  const fibWith = (levels: number[]) =>
    JSON.stringify({ version: 2, drawings: [{ type: 'fib', id: 'f', a: { x: 0, price: 0 }, b: { x: 1, price: 1 }, levels }] });
  const horizontalWith = (id: string) =>
    JSON.stringify({ version: 2, drawings: [{ type: 'horizontal', id, price: 1 }] });

  it('reads a hundred fib levels and refuses a hundred and one', () => {
    const levels = (count: number) => Array.from({ length: count }, (_, index) => index / 100);
    expect(parseDrawings(fibWith(levels(100)))).not.toBeNull();
    expect(parseDrawings(fibWith(levels(101)))).toBeNull();
  });

  it('reads a 128-character id and refuses a 129-character one', () => {
    expect(parseDrawings(horizontalWith('a'.repeat(128)))).not.toBeNull();
    expect(parseDrawings(horizontalWith('a'.repeat(129)))).toBeNull();
  });
});
