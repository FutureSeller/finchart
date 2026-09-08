import { describe, expect, it } from "vitest";
import { toneOf } from "../tone";

/**
 * The one rule every toned indicator bar follows: against the bar before
 * it, `>=` is up and `<` is down. Stateless and lag-1 on purpose — a
 * landing corrects one extra bar and no more, which is only true while
 * the tone remembers exactly one bar back.
 */
describe("toneOf", () => {
  it("is up when the bar is at or above the one before, down below it", () => {
    expect(toneOf(1, 2)).toBe("up");
    expect(toneOf(2, 1)).toBe("down");
    expect(toneOf(-3, -3)).toBe("up"); // a tie is up — the candle's `close >= open`
    expect(toneOf(-1, -2)).toBe("down"); // sign does not enter; the bar fell
  });

  it("has no tone without a previous value, after a gap, or on a gap", () => {
    expect(toneOf(undefined, 2)).toBeUndefined();
    expect(toneOf(null, 2)).toBeUndefined();
    expect(toneOf(2, null)).toBeUndefined();
  });
});
