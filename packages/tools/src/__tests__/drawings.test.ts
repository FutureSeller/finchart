import { describe, expect, it } from "vitest";
import { ContractError } from "@finchart/core";
import { parseDrawings, serializeDrawings, type Drawing } from "../drawings";
import { distanceToSegment } from "../geometry";

describe("serialization", () => {
  const drawings: Drawing[] = [
    { type: "horizontal", price: 104_500 },
    { type: "trend", a: { x: 3, price: 100 }, b: { x: 9, price: 130 } },
    { type: "fib", a: { x: 1, price: 90 }, b: { x: 7, price: 140 } },
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
   * as code.
   */
  it("a frozen v1 payload is read forever", () => {
    const savedByV1 =
      '{"version":1,"drawings":[{"type":"horizontal","price":105},{"type":"trend","a":{"x":3,"price":100},"b":{"x":9,"price":110}},{"type":"fib","a":{"x":1,"price":90},"b":{"x":5,"price":120}}]}';

    expect(parseDrawings(savedByV1)).toEqual([
      { type: "horizontal", price: 105 },
      { type: "trend", a: { x: 3, price: 100 }, b: { x: 9, price: 110 } },
      { type: "fib", a: { x: 1, price: 90 }, b: { x: 5, price: 120 } },
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
    { type: "horizontal", price: NaN },
    { type: "horizontal", price: JSON.parse('{"v":1e999}').v },
    { type: "trend", a: { x: 1, price: NaN }, b: { x: 2, price: 3 } },
    { type: "trend", a: { x: NaN, price: 1 }, b: { x: 2, price: 3 } },
    { type: "fib", a: { x: 1, price: 2 }, b: { x: JSON.parse('{"v":1e999}').v, price: 3 } },
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
      { type: "horizontal", price: 105 },
      { type: "trend", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
      { type: "fib", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
    ];
    const back = parseDrawings(serializeDrawings(good));
    expect(back).toEqual(good);
  });
});
