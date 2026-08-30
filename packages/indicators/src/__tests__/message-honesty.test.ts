import type { OHLC, Source } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { ichimoku, parabolicSar } from "../factories";
import { renko } from "../renko";
import { volumeProfile } from "../volume-profile";

/**
 * Does the message report the value honestly — the indicators edition.
 *
 * ```
 * renko({ brickSize: "5" })       → … got 5      ← looks like a number
 * volumeProfile({ bins: "20" })   → … got 20     ← looks like a number
 * ```
 *
 * The door names itself correctly, but the failure still points debugging
 * in the wrong direction. `period` isn't covered here — it's a door every
 * indicator passes through, so pulling in `describeValue` would push a
 * single indicator's bundle over budget.
 */

const candles: OHLC[] = Array.from({ length: 40 }, (_, x) => ({
  x,
  open: 100 + x,
  high: 102 + x,
  low: 98 + x,
  close: 101 + x,
}));

const source: Source<OHLC> = { read: () => candles };

const STRINGY = "26";

describe("an indicator's numeric door calls a string a string", () => {
  it.each([
    ["renko brickSize", () => renko(candles, { brickSize: STRINGY as never })],
    ["volumeProfile bins", () => volumeProfile({ source, bins: STRINGY as never })],
    [
      "volumeProfile widthFraction",
      () => volumeProfile({ source, widthFraction: "0.28" as never }),
    ],
    [
      "parabolicSar step",
      () => parabolicSar(source, { step: "0.02" as never }),
    ],
    [
      "ichimoku displacement",
      () => ichimoku(source, { displacement: STRINGY as never }),
    ],
  ])("%s", (_door, call) => {
    let message = "";
    try {
      call();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    // Without quotes, the consumer never suspects the type.
    expect(message).toMatch(/"[^"]*"/);
  });

  /** Control — a real number comes through unquoted, as itself. */
  it("control: a real number is written as a number", () => {
    expect(() => renko(candles, { brickSize: Number.NaN })).toThrow(/NaN/);
    expect(() => renko(candles, { brickSize: Number.NaN })).not.toThrow(/"/);
  });
});

/**
 * When `ichimoku({ displacement })` is violated it used to become `NaN`,
 * dropping the `y` key from every point in `spanA`/`spanB` instead of
 * throwing — the consumer ends up suspecting the field name.
 */
describe("ichimoku displacement", () => {
  it.each([
    ["NaN", Number.NaN],
    ["negative", -1],
    ["fraction", 1.5],
    ["string", "26"],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("should reject %s", (_label, bad) => {
    expect(() => ichimoku(source, { displacement: bad as never })).toThrow(
      ContractError,
    );
  });

  it("should name itself and the option", () => {
    expect(() => ichimoku(source, { displacement: Number.NaN })).toThrow(
      /ichimoku\(\{ displacement \}\)/,
    );
  });

  /** Control — a valid value passes through and y survives. */
  it("control: 0 and 26 pass through and points keep y", () => {
    expect(() => ichimoku(source, { displacement: 0 })).not.toThrow();
    const out = ichimoku(source, { displacement: 26 }).out.spanA.read();
    expect(out.every((point) => "y" in point)).toBe(true);
  });
});
