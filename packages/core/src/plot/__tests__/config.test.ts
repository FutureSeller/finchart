/**
 * The config's three doors, tested with no stage — taking one in (copy),
 * changing one (merge), and the numeric guards. These rules used to be
 * checkable only by standing up a whole chart and reading the plot area.
 */
import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import {
  checkPlotNumbers,
  checkViewportSize,
  copyConfig,
  mergeOptions,
  PLOT_CONFIG_DEFAULTS,
  resolveConfig,
} from "../config";
import { createPlotModel } from "../model";
import type { PlotConfig, PlotOptionsPatch } from "../types";

function base(): PlotConfig {
  return {
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
    showGrid: true,
    paneGap: 6,
    shiftVisibleRangeOnNewBar: true,
    axis: {
      x: { showLabels: true, size: 20 },
      y: { position: "right", size: 50 },
    },
    style: { grid: { width: 1 } },
  };
}

describe("mergeOptions", () => {
  it("should treat an explicit undefined flat field as not given", () => {
    const next = mergeOptions(resolveConfig(base()),{
      showGrid: undefined,
      paneGap: undefined,
      shiftVisibleRangeOnNewBar: undefined,
    });
    expect(next.showGrid).toBe(true);
    expect(next.paneGap).toBe(6);
    expect(next.shiftVisibleRangeOnNewBar).toBe(true);
  });

  it("should change only the padding sides given", () => {
    const next = mergeOptions(resolveConfig(base()),{ padding: { left: 40, top: undefined } });
    expect(next.padding).toEqual({ top: 1, right: 2, bottom: 3, left: 40 });
  });

  it("should leave the other axis alone when only one is given", () => {
    const next = mergeOptions(resolveConfig(base()),{ axis: { x: { size: 30 } } });
    expect(next.axis.x).toEqual({
      ...PLOT_CONFIG_DEFAULTS.axis.x,
      showLabels: true,
      size: 30,
    });
    expect(next.axis.y).toEqual({
      ...PLOT_CONFIG_DEFAULTS.axis.y,
      position: "right",
      size: 50,
    });
  });

  it("should let an explicit undefined clear an axis field", () => {
    // The one door where undefined has meaning — "back to the default".
    const next = mergeOptions(resolveConfig(base()),{ axis: { y: { size: undefined } } });
    expect(next.axis?.y).toHaveProperty("size", undefined);
    expect(next.axis?.y?.position).toBe("right");
  });

  it("should refill a cleared axis field that has a default", () => {
    const current = mergeOptions(resolveConfig(base()), {
      axis: { x: { showLabels: false } },
    });
    const next = mergeOptions(current, {
      axis: { x: { showLabels: undefined } },
    });
    expect(next.axis.x.showLabels).toBe(true);
  });

  it("should replace style wholesale", () => {
    expect(mergeOptions(resolveConfig(base()),{ style: { grid: {} } }).style).toEqual({
      grid: {},
    });
    expect(mergeOptions(resolveConfig(base()),{}).style).toEqual({ grid: { width: 1 } });
  });

  it("should not share nested objects with either side", () => {
    const current = resolveConfig(base());
    const patch = { padding: { left: 9 }, axis: { x: { size: 7 } } };
    const next = mergeOptions(current, patch);

    expect(next.padding).not.toBe(current.padding);
    expect(next.padding).not.toBe(patch.padding);
    expect(next.axis?.x).not.toBe(patch.axis.x);
    expect(next.axis?.y).not.toBe(current.axis?.y);
  });
});

describe("mergeOptions — clearing a bar-spacing override", () => {
  it("should drop the key on null so the x mapping's own default is read again", () => {
    const held = mergeOptions(resolveConfig(base()), { minBarSpacing: 3, maxBarSpacing: 40 });
    expect(held.minBarSpacing).toBe(3);
    const cleared = mergeOptions(held, { minBarSpacing: null });
    expect(Object.hasOwn(cleared, "minBarSpacing")).toBe(false);
    expect(cleared.maxBarSpacing).toBe(40);
    const both = mergeOptions(cleared, { maxBarSpacing: null });
    expect(Object.hasOwn(both, "maxBarSpacing")).toBe(false);
  });

  it("should keep the standing value on undefined and take a number as before", () => {
    const held = mergeOptions(resolveConfig(base()), { minBarSpacing: 3 });
    expect(mergeOptions(held, { minBarSpacing: undefined }).minBarSpacing).toBe(3);
    expect(mergeOptions(held, { minBarSpacing: 7 }).minBarSpacing).toBe(7);
  });

  it("should never let null itself reach the resolved config", () => {
    const next = mergeOptions(resolveConfig(base()), { minBarSpacing: null, maxBarSpacing: null });
    expect(next.minBarSpacing).toBeUndefined();
    expect(next.maxBarSpacing).toBeUndefined();
    expect(Object.hasOwn(next, "minBarSpacing")).toBe(false);
  });

  it("should keep absence through copyConfig", () => {
    const next = copyConfig(mergeOptions(resolveConfig(base()), { minBarSpacing: null }));
    expect(Object.hasOwn(next, "minBarSpacing")).toBe(false);
  });
});

describe("copyConfig", () => {
  it("should copy every nested spot so a later edit stays out", () => {
    const source = resolveConfig(base());
    const copy = copyConfig(source);

    source.padding.left = 100;
    if (source.axis?.x) source.axis.x.size = 100;
    if (source.style?.grid) source.style.grid.width = 100;

    expect(copy.padding.left).toBe(4);
    expect(copy.axis?.x?.size).toBe(20);
    expect(copy.style?.grid?.width).toBe(1);
  });

  it("should keep functions — a structured clone would throw on them", () => {
    const format = (value: number): string => `${value}`;
    const copy = copyConfig(resolveConfig({ ...base(), axis: { x: { format } } }));
    expect(copy.axis?.x?.format).toBe(format);
  });
});

describe("checkPlotNumbers", () => {
  it("should reject a non-finite padding side", () => {
    expect(() => checkPlotNumbers({ padding: { left: NaN } })).toThrow(
      ContractError,
    );
  });

  it("should reject a negative gap but accept zero", () => {
    expect(() => checkPlotNumbers({ paneGap: -1 })).toThrow(ContractError);
    expect(() => checkPlotNumbers({ paneGap: 0 })).not.toThrow();
  });

  it("should reach the nested axis sizes", () => {
    expect(() =>
      checkPlotNumbers({ axis: { y: { size: Infinity } } }),
    ).toThrow(ContractError);
    expect(() =>
      checkPlotNumbers({ axis: { x: { minTickSpacing: NaN } } }),
    ).toThrow(ContractError);
  });

  it("should pass an empty patch", () => {
    expect(() => checkPlotNumbers({})).not.toThrow();
  });

  /**
   * The old exemption said rejecting negatives "would break something
   * that currently works" — measured false: a negative minBarSpacing
   * turns the span clamp in x-viewport into an always-true branch and
   * silently locks zoom-out at the current width. Zero stays legal: it
   * is the documented "no limit in that direction".
   */
  it("should reject a negative bar spacing but accept zero", () => {
    expect(() => checkPlotNumbers({ minBarSpacing: -1 })).toThrow(
      ContractError,
    );
    expect(() => checkPlotNumbers({ maxBarSpacing: -0.5 })).toThrow(
      ContractError,
    );
    expect(() => checkPlotNumbers({ minBarSpacing: 0 })).not.toThrow();
    expect(() => checkPlotNumbers({ maxBarSpacing: 0 })).not.toThrow();
  });

  it("should reject min above max when both are positive", () => {
    expect(() =>
      checkPlotNumbers({ minBarSpacing: 100, maxBarSpacing: 50 }),
    ).toThrow(ContractError);
    // Equal is a fixed spacing, not a contradiction.
    expect(() =>
      checkPlotNumbers({ minBarSpacing: 50, maxBarSpacing: 50 }),
    ).not.toThrow();
    // Zero means "no limit on that side" — it can't contradict the other.
    expect(() =>
      checkPlotNumbers({ minBarSpacing: 100, maxBarSpacing: 0 }),
    ).not.toThrow();
  });
});

describe("checkPlotNumbers — null clears a spacing override", () => {
  it("should pass null alone and null beside a number", () => {
    expect(() => checkPlotNumbers({ minBarSpacing: null })).not.toThrow();
    expect(() => checkPlotNumbers({ minBarSpacing: null, maxBarSpacing: 5 })).not.toThrow();
    expect(() => checkPlotNumbers({ minBarSpacing: 5, maxBarSpacing: null })).not.toThrow();
  });

  it("should still reject min above max when both are positive numbers", () => {
    expect(() => checkPlotNumbers({ minBarSpacing: 9, maxBarSpacing: 5 })).toThrow(ContractError);
  });

  it("should still reject anything that is not a number, on either key — only null and undefined skip the guard", () => {
    for (const junk of ['"9"', '"oops"', "false", "{}", "[]", "NaN"]) {
      const value = junk === "NaN" ? "null" : junk;
      const asMin: PlotOptionsPatch = JSON.parse(`{"minBarSpacing": ${value}, "maxBarSpacing": 5}`);
      const asMax: PlotOptionsPatch = JSON.parse(`{"minBarSpacing": 1, "maxBarSpacing": ${value}}`);
      if (junk === "NaN") {
        asMin.minBarSpacing = Number.NaN;
        asMax.maxBarSpacing = Number.NaN;
      }
      expect(() => checkPlotNumbers(asMin), `min ${junk}`).toThrow(ContractError);
      expect(() => checkPlotNumbers(asMax), `max ${junk}`).toThrow(ContractError);
    }
  });

  it("should refuse null at the constructor's door — there is nothing to clear there", () => {
    const patch: PlotOptionsPatch = JSON.parse('{"minBarSpacing": null}');
    expect(() => checkPlotNumbers(patch, "construct")).toThrow(ContractError);
    expect(() => checkPlotNumbers({ maxBarSpacing: null }, "construct")).toThrow(ContractError);
    expect(() => checkPlotNumbers({ minBarSpacing: null })).not.toThrow();
    // Through the real door, so the resolved config never carries a null.
    const config: PlotConfig = JSON.parse('{"maxBarSpacing": null}');
    expect(() => createPlotModel({ size: { width: 400, height: 300 }, config })).toThrow(ContractError);
  });
});

describe("checkViewportSize", () => {
  it("should reject a negative side and accept zero", () => {
    expect(() => checkViewportSize({ width: -1, height: 10 })).toThrow(
      ContractError,
    );
    expect(() => checkViewportSize({ width: 0, height: 0 })).not.toThrow();
  });
});
