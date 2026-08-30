/**
 * `assertFinite` checks all four of a bar's values. It's hand-unrolled
 * instead of a `for (const field of OHLC_FIELDS)` loop because this sits on
 * the tick path for a live registration, where the runtime cost of a
 * dynamic field lookup far outweighs the cost of the guard itself — instead,
 * this test mechanically holds the line that "no field slips through." If a
 * fifth field gets added to `OHLC_FIELDS` and `assertFinite` isn't updated
 * to match, this goes red.
 */
import { describe, expect, it } from "vitest";
import { OHLC_FIELDS, OHLCAccessor } from "../accessors";
import type { OHLC } from "../types";

const GOOD: OHLC = { x: 0, open: 100, high: 110, low: 90, close: 105 };

describe("the OHLC data door", () => {
  const accessor = new OHLCAccessor();

  it("should have something to check", () => {
    // If this were 0, the assertion below would pass vacuously.
    expect(OHLC_FIELDS.length).toBeGreaterThan(3);
  });

  it.each(OHLC_FIELDS)("should reject a non-finite %s", (field) => {
    for (const bad of [NaN, Infinity, -Infinity, "100", null, undefined]) {
      const point = { ...GOOD, [field]: bad };

      let message = "";
      try {
        accessor.assertFinite(point, 7);
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }

      expect(message).toContain(field); // throwing alone isn't enough — naming the field is what lets a consumer find it
      expect(message).toContain("7");
    }
  });

  it("should accept a bar whose four values are all finite", () => {
    expect(() => accessor.assertFinite(GOOD, 0)).not.toThrow();
  });
});
