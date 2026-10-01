/**
 * Conditions where a value crosses a boundary -- this guards the
 * boundaries of a drawing. If only `parseDrawings` checks finiteness and
 * `add` doesn't, `load` ends up rejecting what `add` already accepted,
 * and the all-or-nothing rule takes the intact drawings down with it.
 * What this file protects is that symmetry between entry and exit.
 */
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { parseDrawings, serializeDrawings } from "../drawings";

const HOSTILE = JSON.parse('{"v":1e999}').v as number;

describe("parseDrawings does not throw", () => {
  it.each([
    "",
    "null",
    "0",
    '"string"',
    "[]",
    "{}",
    "{broken",
    '{"version":1}',
    '{"version":1,"drawings":"not an array"}',
    '{"version":999,"drawings":[]}',
  ])("should return null for %j without throwing", (payload) => {
    let result: unknown;
    expect(() => {
      result = parseDrawings(payload);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  /**
   * `JSON.parse` turns `__proto__` into an **own data property**
   * (CreateDataProperty), and `tools` has no `Object.assign` or
   * recursive merge. This makes sure that property is never lost.
   */
  it("should never pollute Object.prototype", () => {
    parseDrawings('{"version":2,"__proto__":{"polluted":true},"drawings":[]}');
    parseDrawings(
      '{"version":2,"drawings":[{"type":"horizontal","id":"h","price":1,"__proto__":{"polluted":true}}]}',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("entry and exit reject the same things", () => {
  const bad: Drawing[] = [
    { type: "horizontal", id: "b1", price: NaN },
    { type: "horizontal", id: "b2", price: HOSTILE },
    { type: "trend", id: "b3", a: { x: 1, price: NaN }, b: { x: 2, price: 3 } },
    { type: "trend", id: "b4", a: { x: HOSTILE, price: 1 }, b: { x: 2, price: 3 } },
    { type: "fib", id: "b5", a: { x: 1, price: 2 }, b: { x: 3, price: HOSTILE } },
  ];

  /**
   * Rejection happens at the entry point -- if the save succeeds and the
   * next session's parser rejects it instead, the consumer ends up
   * silently facing a total loss of the ledger.
   */
  it("should refuse every non-finite shape at serialization", () => {
    for (const drawing of bad) {
      expect(() => serializeDrawings([drawing])).toThrow(ContractError);
    }
  });

  /**
   * The round trip doesn't reject its own output -- whatever string
   * `serialize` produces, `parseDrawings` must be able to read back.
   */
  it("should round-trip everything it accepts", () => {
    const good: Drawing[] = [
      { type: "horizontal", id: "h1", price: 105 },
      { type: "trend", id: "t1", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
      { type: "fib", id: "f1", a: { x: 1, price: 2 }, b: { x: 3, price: 4 } },
    ];
    expect(parseDrawings(serializeDrawings(good))).toEqual(good);
  });
});
