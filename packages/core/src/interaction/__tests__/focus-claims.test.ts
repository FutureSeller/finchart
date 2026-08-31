/**
 * The keyboard-focus contest on its own. The chart-level witness
 * (`focus-claim.test.ts`) stays; this one reaches the rules that never
 * needed a stage — a neighbor that throws, returns garbage, or claims a
 * degenerate area.
 */
import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import { focusClaims } from "../focus-claims";

const box = { left: 0, right: 100, top: 0, bottom: 50 };

describe("focusClaims", () => {
  it("should reject a non-function at the door", () => {
    const claims = focusClaims();
    // @ts-expect-error a plain wrong argument — the door must name it, not crash on it
    expect(() => claims.claim(null)).toThrow(ContractError);
  });

  it("should not count the claimant itself", () => {
    const claims = focusClaims();
    const mine = claims.claim(() => box);
    expect(mine.contestedAt({ x: 10, y: 10 })).toBe(false);
  });

  it("should say contested when another claimant covers the point", () => {
    const claims = focusClaims();
    claims.claim(() => box);
    const mine = claims.claim(() => null);
    expect(mine.contestedAt({ x: 10, y: 10 })).toBe(true);
    expect(mine.contestedAt({ x: 10, y: 60 })).toBe(false);
  });

  it("should treat a bottom edge as the neighbor below's", () => {
    const claims = focusClaims();
    claims.claim(() => box);
    const mine = claims.claim(() => null);
    expect(mine.contestedAt({ x: 10, y: 50 })).toBe(false);
  });

  it("should treat a throwing or garbage neighbor as not contesting", () => {
    const claims = focusClaims();
    claims.claim(() => {
      throw new Error("someone else's bug");
    });
    // @ts-expect-error someone else's extension returning the wrong shape
    claims.claim(() => ({ left: "0" }));
    claims.claim(() => ({ left: 0, right: NaN, top: 0, bottom: 10 }));
    const mine = claims.claim(() => null);
    expect(mine.contestedAt({ x: 1, y: 1 })).toBe(false);
  });

  it("should treat a degenerate area as not contesting", () => {
    const claims = focusClaims();
    claims.claim(() => ({ left: 10, right: 10, top: 0, bottom: 50 }));
    const mine = claims.claim(() => null);
    expect(mine.contestedAt({ x: 10, y: 10 })).toBe(false);
  });

  it("should ask everyone so a throwing neighbor's order never matters", () => {
    const claims = focusClaims();
    let asked = 0;
    claims.claim(() => box);
    claims.claim(() => {
      asked += 1;
      return null;
    });
    const mine = claims.claim(() => null);

    expect(mine.contestedAt({ x: 10, y: 10 })).toBe(true);
    expect(asked).toBe(1);
  });

  it("should stop contesting after release, and release twice safely", () => {
    const claims = focusClaims();
    const other = claims.claim(() => box);
    const mine = claims.claim(() => null);

    other.release();
    other.release();

    expect(mine.contestedAt({ x: 10, y: 10 })).toBe(false);
  });

  it("should reject a bad point in the same vocabulary as the other doors", () => {
    const claims = focusClaims();
    const mine = claims.claim(() => null);
    // @ts-expect-error a consumer clearing on pointerleave with null
    expect(() => mine.contestedAt(null)).toThrow(ContractError);
  });
});
