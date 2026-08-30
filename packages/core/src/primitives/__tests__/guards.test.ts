/**
 * Unit tests for the boundary-value-checking vocabulary. Whether the real
 * call sites actually use this vocabulary is checked by
 * `__tests__/boundary-values.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { ContractError } from "../errors";
import {
  asFinite,
  asIndex,
  requireFinite,
  requireInterval,
  requireNonNegative,
} from "../guards";

/** JSON can't carry an Infinity literal — this is how it arrives from the outside anyway. */
const JSON_INFINITY = JSON.parse('{"v":1e999}').v as number;
const JSON_NEG_INFINITY = JSON.parse('{"v":-1e999}').v as number;

describe("Infinity via JSON — the premise behind these tests", () => {
  it("should produce Infinity from an overflowing JSON literal", () => {
    expect(JSON_INFINITY).toBe(Infinity);
    expect(JSON_NEG_INFINITY).toBe(-Infinity);
  });
});

describe("requireFinite", () => {
  it("should pass finite numbers through unchanged", () => {
    expect(requireFinite(0, "x")).toBe(0);
    expect(requireFinite(-1.5, "x")).toBe(-1.5);
    expect(requireFinite(Number.MAX_VALUE, "x")).toBe(Number.MAX_VALUE);
  });

  it("should reject NaN and both infinities", () => {
    for (const bad of [NaN, Infinity, -Infinity, JSON_INFINITY]) {
      expect(() => requireFinite(bad, "width")).toThrow(ContractError);
    }
  });

  it("should name the argument in the message", () => {
    expect(() => requireFinite(NaN, "width")).toThrow(/width/);
    // The value too — it names both "what's wrong" and "which argument."
    expect(() => requireFinite(Infinity, "width")).toThrow(/Infinity/);
  });
});

describe("requireNonNegative", () => {
  it("should pass non-negative finite numbers", () => {
    expect(requireNonNegative(1, "flex")).toBe(1);
    expect(requireNonNegative(1e-9, "flex")).toBe(1e-9);
  });

  it("should accept zero — flex 0 is how paneMaximize collapses a pane", () => {
    // Zero is legal (a collapsed pane). If positive were enforced, pane maximize would break.
    expect(requireNonNegative(0, "flex")).toBe(0);
  });

  it("should reject negatives", () => {
    expect(() => requireNonNegative(-1, "flex")).toThrow(ContractError);
  });

  it("should reject NaN — the trap that value < 0 misses", () => {
    // `NaN < 0` is false. Only `!(NaN >= 0)` catches it.
    expect(() => requireNonNegative(NaN, "flex")).toThrow(ContractError);
  });

  it("should reject Infinity — the trap that value > 0 let through", () => {
    // `record.flex > 0` lets Infinity through.
    expect(() => requireNonNegative(JSON_INFINITY, "flex")).toThrow(ContractError);
  });
});

describe("requireInterval", () => {
  it("should return the pair when finite and ordered", () => {
    expect(requireInterval(0, 10, "domain")).toEqual([0, 10]);
  });

  it("should reject an unordered or degenerate interval", () => {
    expect(() => requireInterval(10, 0, "domain")).toThrow(ContractError);
    expect(() => requireInterval(5, 5, "domain")).toThrow(ContractError);
  });

  it("should reject a pair where only one end is bad", () => {
    // Checking only one side would let [5, -Infinity] pass as "min is finite."
    expect(() => requireInterval(5, JSON_NEG_INFINITY, "domain")).toThrow(ContractError);
    expect(() => requireInterval(JSON_NEG_INFINITY, 5, "domain")).toThrow(ContractError);
    expect(() => requireInterval(NaN, 5, "domain")).toThrow(ContractError);
  });

  it("should reject the infinite span that min < max lets through", () => {
    // `-Infinity < Infinity`, so a `min >= max` check alone can't catch this.
    expect(() => requireInterval(-Infinity, Infinity, "domain")).toThrow(ContractError);
  });
});

describe("asFinite", () => {
  it("should return the number when finite", () => {
    expect(asFinite(0)).toBe(0);
    expect(asFinite(-3.25)).toBe(-3.25);
  });

  it("should return undefined for non-finite and non-numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity, JSON_INFINITY, "1", null, undefined, {}, []]) {
      expect(asFinite(bad)).toBeUndefined();
    }
  });

  it("should not throw — parsers report absence, not error", () => {
    expect(() => asFinite(NaN)).not.toThrow();
  });
});

describe("asIndex", () => {
  it("should accept in-range integers", () => {
    expect(asIndex(0, 3)).toBe(0);
    expect(asIndex(2, 3)).toBe(2);
  });

  it("should reject fractions — the 36th-review hole", () => {
    // `0 <= 0.5 < 3` is true, but `panes[0.5]` is undefined.
    expect(asIndex(0.5, 3)).toBeUndefined();
    expect(asIndex(1.0000001, 3)).toBeUndefined();
  });

  it("should reject out-of-range and negative", () => {
    expect(asIndex(3, 3)).toBeUndefined();
    expect(asIndex(-1, 3)).toBeUndefined();
  });

  it("should reject non-finite and non-numbers", () => {
    for (const bad of [NaN, JSON_INFINITY, "0", null, undefined]) {
      expect(asIndex(bad, 3)).toBeUndefined();
    }
  });

  it("should reject everything when the limit is zero", () => {
    expect(asIndex(0, 0)).toBeUndefined();
  });
});
