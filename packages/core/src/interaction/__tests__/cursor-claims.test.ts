/** The cursor claim stack on its own — the layer is a recording function. */
import { describe, expect, it } from "vitest";
import { cursorClaims } from "../cursor-claims";

function setup() {
  const applied: (string | null)[] = [];
  const claims = cursorClaims((cursor) => applied.push(cursor));
  return { claims, applied };
}

describe("cursorClaims", () => {
  it("should apply a claim and take it back on release", () => {
    const { claims, applied } = setup();
    const release = claims.claim("grab");
    release();
    expect(applied).toEqual(["grab", null]);
  });

  it("should let the last claim win and fall back on release", () => {
    const { claims, applied } = setup();
    claims.claim("crosshair");
    const drag = claims.claim("grabbing");
    drag();
    expect(applied).toEqual(["crosshair", "grabbing", "crosshair"]);
  });

  it("should keep the top when a buried claim is released", () => {
    const { claims, applied } = setup();
    const hover = claims.claim("crosshair");
    claims.claim("grabbing");
    hover();
    expect(applied).toEqual(["crosshair", "grabbing"]);
  });

  it("should not touch the layer when the top keeps its shape", () => {
    const { claims, applied } = setup();
    claims.claim("grab");
    claims.claim("grab");
    expect(applied).toEqual(["grab"]);
  });

  it("should keep two claims of the same shape apart", () => {
    const { claims, applied } = setup();
    const first = claims.claim("grab");
    claims.claim("grab");
    first();
    first();
    // The second claim still holds the shape — nothing was released.
    expect(applied).toEqual(["grab"]);
  });

  it("should stay harmless with no layer to apply to", () => {
    const claims = cursorClaims(undefined);
    expect(() => claims.claim("grab")()).not.toThrow();
  });
});
