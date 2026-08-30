/**
 * Style values also come from the outside — this is zero trust's style
 * axis. There was a spot where a value like `--chart-candle-up: nope`
 * painted a candle with whatever color the previous drawing command had
 * left set, instead of falling back — the promise that "a parse failure
 * falls back to the default" was a lie.
 *
 * CSS variables are a zero-trust surface by definition — `getComputedStyle`
 * hands back a string no matter what, and we have no control over what a
 * consumer assigns to it. This channel arrives as a callback's return
 * value rather than a public function's argument, so the public-API census
 * in `boundary-values.test.ts` can't catch it here — hence this separate axis.
 */
import { describe, expect, it } from "vitest";
import { resolveStyle } from "../style-spec";

const SPEC = {
  width: { css: "--w", fallback: 1.5 },
  ratio: { css: "--r", fallback: 0.6, range: [0, 1] as [number, number] },
  color: { css: "--c", fallback: "#16a34a" },
};

const read = (values: Record<string, string>) => (name: string) =>
  values[name] ?? "";

describe("Z2 — a numeric leaf only accepts a bare number or px", () => {
  it.each([
    ["0.5rem", 1.5],
    ["60%", 1.5],
    ["2em", 1.5],
    ["abc", 1.5],
    ["", 1.5],
    ["1e999", 1.5],
  ])("should fall back for %s", (raw, expected) => {
    expect(resolveStyle(SPEC, read({ "--w": raw })).width).toBe(expected);
  });

  it.each([
    ["2", 2],
    ["2px", 2],
    ["1.5", 1.5],
    [" 3px ", 3],
    ["-1", -1],
  ])("should read %s", (raw, expected) => {
    expect(resolveStyle(SPEC, read({ "--w": raw })).width).toBe(expected);
  });

  /** If `60%` read as 60, `range` would clamp it to 1.0 and the candle body would fill the whole slot — that's why the unit gets filtered out first. */
  it("should not let a percentage sneak past the range clamp", () => {
    expect(resolveStyle(SPEC, read({ "--r": "60%" })).ratio).toBe(0.6);
    // A bare number lets clamp work normally.
    expect(resolveStyle(SPEC, read({ "--r": "2" })).ratio).toBe(1);
  });
});

describe("Z2 — a color leaf passes the string through untouched (the renderer judges it)", () => {
  /**
   * The core has no CSS parser — a color's validity is judged
   * by the canvas, and `applyColor` drops a rejected assignment to
   * transparent. Not drawing is more honest than drawing with a neighbor's color.
   */
  it("should pass a color string through untouched", () => {
    expect(resolveStyle(SPEC, read({ "--c": "nope" })).color).toBe("nope");
    expect(resolveStyle(SPEC, read({ "--c": "currentColor" })).color).toBe(
      "currentColor",
    );
  });

  it("should fall back only when the value is empty", () => {
    expect(resolveStyle(SPEC, read({})).color).toBe("#16a34a");
  });
});
