/**
 * The resolver's contract — override > CSS variable > default, and the
 * boundaries between them.
 *
 * No browser needed: with a fake reader, the whole CSS-variable-to-resolved-
 * value path is a pure function — the seam was made for testability.
 */
import { describe, expect, it } from "vitest";
import type { StyleReader } from "../style-reader";
import {
  cssVarExpr,
  noStyle,
  resolveStyle,
  styleVars,
} from "../style-spec";
import type { StyleSpec } from "../style-spec";

interface FakeStyle {
  line: { width: number; color: string; dashArray?: string };
  fill: string;
}

const SPEC = {
  line: {
    width: { css: "--chart-fake-width", fallback: 2 },
    color: { css: "--chart-fake", fallback: "#111111" },
  },
  fill: { css: "--chart-fake-fill", fallback: "#222222" },
} satisfies StyleSpec<FakeStyle>;

const readerOf = (table: Record<string, string>): StyleReader => {
  return (name) => table[name] ?? "";
};

describe("resolveStyle", () => {
  it("should fall back to defaults when nothing is set", () => {
    expect(resolveStyle(SPEC, noStyle)).toEqual({
      line: { width: 2, color: "#111111" },
      fill: "#222222",
    });
  });

  it("should read css variables over defaults", () => {
    const read = readerOf({
      "--chart-fake-width": "3.5",
      "--chart-fake-fill": "#abcdef",
    });

    expect(resolveStyle(SPEC, read)).toEqual({
      line: { width: 3.5, color: "#111111" },
      fill: "#abcdef",
    });
  });

  it("should degrade unparsable numbers to the fallback", () => {
    // "12px" reads as 12 — parseFloat's leniency. Only "abc" falls back to the default.
    expect(
      resolveStyle(SPEC, readerOf({ "--chart-fake-width": "12px" })).line.width,
    ).toBe(12);
    expect(
      resolveStyle(SPEC, readerOf({ "--chart-fake-width": "abc" })).line.width,
    ).toBe(2);
  });

  it("should clamp css numbers into the declared range", () => {
    const clamped = {
      ratio: { css: "--chart-fake-ratio", fallback: 0.5, range: [0, 1] },
    } as const;

    expect(
      resolveStyle(clamped, readerOf({ "--chart-fake-ratio": "3" })).ratio,
    ).toBe(1);
    expect(
      resolveStyle(clamped, readerOf({ "--chart-fake-ratio": "-2" })).ratio,
    ).toBe(0);
    expect(
      resolveStyle(clamped, readerOf({ "--chart-fake-ratio": "0.4" })).ratio,
    ).toBe(0.4);
  });

  it("should let overrides win over css variables", () => {
    const read = readerOf({ "--chart-fake": "#333333" });

    expect(
      resolveStyle(SPEC, read, { line: { color: "#999999" } }).line.color,
    ).toBe("#999999");
  });

  it("should demote undefined and null overrides to absence", () => {
    // It's common for state serialization or a React props round trip to
    // turn undefined into null. Neither one should win over a CSS variable (PRINCIPLE 16).
    const read = readerOf({ "--chart-fake-width": "7" });

    expect(
      resolveStyle(SPEC, read, { line: { width: undefined } }).line.width,
    ).toBe(7);
    expect(
      resolveStyle(SPEC, read, { line: { width: null as never } }).line.width,
    ).toBe(7);
  });

  it("should ignore keys the spec does not declare", () => {
    const resolved = resolveStyle(SPEC, noStyle, {
      line: { ghost: "#ff0000" },
      __proto__: { hacked: true },
    } as never);

    expect(resolved).toEqual({
      line: { width: 2, color: "#111111" },
      fill: "#222222",
    });
    expect("ghost" in resolved.line).toBe(false);
  });

  it("should resolve nested groups independently", () => {
    const resolved = resolveStyle(SPEC, noStyle, { fill: "#444444" });

    expect(resolved.fill).toBe("#444444");
    expect(resolved.line).toEqual({ width: 2, color: "#111111" });
  });

  it("should omit optional leaves the spec omits", () => {
    // dashArray exists on FakeStyle but not on SPEC — it must be absent from the result too.
    expect("dashArray" in resolveStyle(SPEC, noStyle).line).toBe(false);
  });
});

describe("styleVars", () => {
  it("should list every declared variable, sorted", () => {
    expect(styleVars(SPEC)).toEqual([
      "--chart-fake",
      "--chart-fake-fill",
      "--chart-fake-width",
    ]);
  });
});

describe("cssVarExpr", () => {
  it("should render an inline var() with its fallback", () => {
    expect(cssVarExpr(SPEC.fill)).toBe("var(--chart-fake-fill, #222222)");
  });
});
