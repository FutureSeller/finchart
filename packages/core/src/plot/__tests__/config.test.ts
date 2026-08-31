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
} from "../config";
import type { PlotConfig } from "../types";

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
    const next = mergeOptions(base(), {
      showGrid: undefined,
      paneGap: undefined,
      shiftVisibleRangeOnNewBar: undefined,
    });
    expect(next.showGrid).toBe(true);
    expect(next.paneGap).toBe(6);
    expect(next.shiftVisibleRangeOnNewBar).toBe(true);
  });

  it("should change only the padding sides given", () => {
    const next = mergeOptions(base(), { padding: { left: 40, top: undefined } });
    expect(next.padding).toEqual({ top: 1, right: 2, bottom: 3, left: 40 });
  });

  it("should leave the other axis alone when only one is given", () => {
    const next = mergeOptions(base(), { axis: { x: { size: 30 } } });
    expect(next.axis?.x).toEqual({ showLabels: true, size: 30 });
    expect(next.axis?.y).toEqual({ position: "right", size: 50 });
  });

  it("should let an explicit undefined clear an axis field", () => {
    // The one door where undefined has meaning — "back to the default".
    const next = mergeOptions(base(), { axis: { y: { size: undefined } } });
    expect(next.axis?.y).toHaveProperty("size", undefined);
    expect(next.axis?.y?.position).toBe("right");
  });

  it("should replace style wholesale", () => {
    expect(mergeOptions(base(), { style: { grid: {} } }).style).toEqual({
      grid: {},
    });
    expect(mergeOptions(base(), {}).style).toEqual({ grid: { width: 1 } });
  });

  it("should not share nested objects with either side", () => {
    const current = base();
    const patch = { padding: { left: 9 }, axis: { x: { size: 7 } } };
    const next = mergeOptions(current, patch);

    expect(next.padding).not.toBe(current.padding);
    expect(next.padding).not.toBe(patch.padding);
    expect(next.axis?.x).not.toBe(patch.axis.x);
    expect(next.axis?.y).not.toBe(current.axis?.y);
  });
});

describe("copyConfig", () => {
  it("should copy every nested spot so a later edit stays out", () => {
    const source = base();
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
    const copy = copyConfig({ ...base(), axis: { x: { format } } });
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
});

describe("checkViewportSize", () => {
  it("should reject a negative side and accept zero", () => {
    expect(() => checkViewportSize({ width: -1, height: 10 })).toThrow(
      ContractError,
    );
    expect(() => checkViewportSize({ width: 0, height: 0 })).not.toThrow();
  });
});
