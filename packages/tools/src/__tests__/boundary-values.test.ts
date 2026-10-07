/**
 * Conditions where a value crosses a boundary -- what comes in through
 * `parseDrawings` is someone else's string (a URL, a stored session), so
 * the parser must answer null rather than throw, and must not let the
 * payload reach `Object.prototype`. The entry/exit symmetry (serialize
 * refuses what parse would refuse, and round-trips what it accepts) lives
 * in `drawings.test.ts` and `kind-spec.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseDrawings } from "../drawings";

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
