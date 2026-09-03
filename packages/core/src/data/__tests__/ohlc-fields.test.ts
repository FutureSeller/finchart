/**
 * `assertFinite` checks a bar's values by hand instead of a loop — this
 * sits on the tick path for a live registration, where a dynamic field
 * lookup costs more than the guard. So a test holds the line that "no
 * field slips through," and it holds **two rules**: the four prices reject
 * everything that isn't a finite number (`null` and absence included — a
 * bar without a close is nothing to draw), while volume treats `null` and
 * absence as a gap and rejects only a present non-number. Add a field to
 * either list without updating `assertFinite` and this goes red.
 */
import { describe, expect, it } from "vitest";
import { OHLC_FIELDS, OHLC_GAP_FIELDS, OHLCAccessor } from "../accessors";
import type { OHLC } from "../types";

const GOOD: OHLC = { x: 0, open: 100, high: 110, low: 90, close: 105, volume: 1_000 };

function messageOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  return "";
}

describe("the OHLC data door", () => {
  const accessor = new OHLCAccessor();

  it("should have something to check", () => {
    // If these were 0, the assertions below would pass vacuously.
    expect(OHLC_FIELDS.length).toBeGreaterThan(3);
    expect(OHLC_GAP_FIELDS.length).toBeGreaterThan(0);
  });

  it.each(OHLC_FIELDS)("should reject a non-finite %s — null and absence included", (field) => {
    for (const bad of [NaN, Infinity, -Infinity, "100", null, undefined]) {
      const message = messageOf(() => accessor.assertFinite({ ...GOOD, [field]: bad }, 7));
      expect(message).toContain(field); // throwing alone isn't enough — naming the field is what lets a consumer find it
      expect(message).toContain("7");
    }
  });

  it.each(OHLC_GAP_FIELDS)("should reject a present non-number %s, and pass a gap", (field) => {
    for (const bad of [NaN, Infinity, -Infinity, "1234"]) {
      const point: OHLC = { ...GOOD };
      Reflect.set(point, field, bad);
      const message = messageOf(() => accessor.assertFinite(point, 7));
      expect(message).toContain(field);
      expect(message).toContain("7");
    }
    for (const gap of [null, undefined]) {
      const point: OHLC = { ...GOOD };
      Reflect.set(point, field, gap);
      expect(() => accessor.assertFinite(point, 7)).not.toThrow();
    }
  });

  it("should accept a bar whose values are all finite", () => {
    expect(() => accessor.assertFinite(GOOD, 0)).not.toThrow();
  });
});
