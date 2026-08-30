/**
 * Its sibling `vwap` calls `anchor?.()`, so it's optional and safe, but
 * `pivotPoints` requires it, and without a guard you get a raw
 * `TypeError: anchor is not a function` — this test checks that it throws
 * a door that names the option instead. The assumed consumer is one who
 * isn't using TypeScript.
 */
import type { OHLC, Source } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { pivotPoints, vwap } from "../factories";
import {
  attachMovingAverage,
  attachPivotPoints,
  attachRsi,
} from "../plugins";

const bars: OHLC[] = Array.from({ length: 30 }, (_, x) => ({
  x,
  open: 100 + x,
  high: 102 + x,
  low: 98 + x,
  close: 101 + x,
}));
const candles = (): Source<OHLC> => ({ read: () => bars });

describe("pivotPoints's anchor must be a predicate", () => {
  const HOSTILE: [string, unknown][] = [
    ["none", undefined],
    ["null", null],
    ["string", "daily"],
    ["number", 1],
    ["object", {}],
  ];

  for (const [name, value] of HOSTILE) {
    it(`pivotPoints({ anchor: ${name} }) is rejected by name`, () => {
      const source = candles();
      expect(() =>
        // The type system blocks this value — the victim is a consumer
        // who isn't using TS.
        pivotPoints(source, { anchor: value as never }),
      ).toThrow(ContractError);
      expect(() =>
        pivotPoints(source, { anchor: value as never }),
      ).toThrow(/pivotPoints\(\{ anchor \}\)/);
    });
  }

  it("the assembly door (attachPivotPoints) rejects with the same name too", () => {
    // The plugin is a function that `pane.use` calls, so call that
    // function directly to exercise the assembly step.
    const install = attachPivotPoints({ source: candles() } as never);
    expect(() => install({} as never)).toThrow(ContractError);
  });

  it("control: given a predicate, it computes normally", () => {
    const node = pivotPoints(candles(), {
      anchor: (_point, index) => index % 10 === 0,
    });

    expect(node.out.p.read().some((value) => value !== null)).toBe(true);
  });

  it("control: vwap's anchor is optional, so it's fine without one — the asymmetry is intentional", () => {
    expect(() => vwap(candles(), {})).not.toThrow();
  });
});

/**
 * When `source` is missing from an `attach*` call, the core computation
 * door used to answer positionally ("input 0"), so the consumer couldn't
 * tell which option key was missing — now it names it.
 */
describe("attach door's source", () => {
  it("when missing, it names the option — not the position", () => {
    // Thrown directly from the assembly door — it never reaches the core
    // computation door inside pane.use.
    expect(() => attachMovingAverage({ period: 20 } as never)).toThrow(
      /attachMovingAverage\(\{ source \}\)/,
    );
  });

  it("names the same option even when the shape is wrong", () => {
    expect(() => attachRsi({ source: "price" } as never)).toThrow(
      /attachRsi\(\{ source \}\)/,
    );
  });

  it("control: a properly supplied source passes through untouched", () => {
    const install = attachMovingAverage({ source: candles(), period: 5 });
    expect(typeof install).toBe("function");
  });
});
