import { describe, expect, it } from "vitest";
import { ContractError } from "@finchart/core";
import { parseDrawings, serializeDrawings, type Drawing } from "../drawings";
import { distanceToSegment } from "../geometry";

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
   * v1 is read forever — that's the contract from the moment it ships. A
   * round-trip test alone can't guarantee this: if the serializer and
   * parser change together, the round trip stays green while an old
   * string sitting in a consumer's storage (localStorage, a server, a
   * URL) can break. So this payload is pinned as a literal string, not
   * as code. The ids are the migration's — derived from position, so the
   * same string parses to the same ledger on every read (a random mint
   * here would orphan a side panel's id-keyed state on every refresh,
   * since a load-only session never runs the save recipe).
   */
  it("a frozen v1 payload is read forever, with deterministic ids", () => {
    const savedByV1 =
      '{"version":1,"drawings":[{"type":"horizontal","price":105},{"type":"trend","a":{"x":3,"price":100},"b":{"x":9,"price":110}},{"type":"fib","a":{"x":1,"price":90},"b":{"x":5,"price":120}}]}';

    const expected = [
      { type: "horizontal", id: "v1-0", price: 105 },
      { type: "trend", id: "v1-1", a: { x: 3, price: 100 }, b: { x: 9, price: 110 } },
      { type: "fib", id: "v1-2", a: { x: 1, price: 90 }, b: { x: 5, price: 120 } },
    ];
    expect(parseDrawings(savedByV1)).toEqual(expected);
    // Parsing twice yields the same ledger — determinism is the contract.
    expect(parseDrawings(savedByV1)).toEqual(expected);
  });

  /** The v2 counterpart of the frozen-v1 pin — from the day v2 ships, this string is read forever too. */
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

  /**
   * The round trip doesn't reject its own output -- whatever `add`
   * accepts, `load` must be able to read back.
   */
  it("should round-trip anything the parser accepts", () => {
    const good: Drawing[] = [
      { type: "horizontal", id: "h1", price: 105 },
      { type: "trend", id: "t1", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
      { type: "fib", id: "f1", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
    ];
    const back = parseDrawings(serializeDrawings(good));
    expect(back).toEqual(good);
  });
});
