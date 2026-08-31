/** Tests the geometry of a single frame with no stage — just one area and a few panes is enough. */
import { describe, expect, it, vi } from "vitest";
import { AXIS_LABEL_OFFSET } from "../../axis";
import type { DataManagerFactory } from "../../data";
import { M4Decimation, SimpleDataManager } from "../../data";
import type { PlotArea } from "../../primitives";
import { barIndexX, continuousX, LinearScale } from "../../scale";
import { resolveConfig } from "../config";
import { layoutFrame, type FrameInput, type FrameMeasure } from "../frame";
import type { PlotConfig } from "../types";
import { FALLBACK_X_AXIS_HEIGHT, FALLBACK_Y_AXIS_WIDTH } from "../layout";
import { Pane } from "../pane";

const AREA: PlotArea = { left: 0, right: 800, top: 0, bottom: 600 };

const managers: DataManagerFactory = (coordinates) =>
  new SimpleDataManager({
    decimation: new M4Decimation(coordinates),
    coordinates,
  });

/** A ruler where each character is 7px wide and 10px tall. Expected values can be computed by hand. */
const ruler = (): FrameMeasure => ({
  font: "12px test",
  of: (text) => ({ width: text.length * 7, height: 10 }),
});

function panes(count: number, domains: [number, number][] = []): Pane[] {
  return Array.from({ length: count }, (_, i) => {
    const scale = new LinearScale();
    const [min, max] = domains[i] ?? [0, 100];
    scale.setDomain(min, max);
    return new Pane(scale, managers);
  });
}

/** `FrameInput.axis` is the resolved shape — built through the real door, so fixtures stay sparse. */
const ax = (axis: PlotConfig["axis"] = {}) => resolveConfig({ axis }).axis;

function frame(overrides: Partial<FrameInput> = {}) {
  const xScale = new LinearScale();
  xScale.setDomain(0, 100);

  const input: FrameInput = {
    area: AREA,
    panes: panes(1),
    gap: 0,
    axis: ax(),
    xScale,
    x: continuousX(xScale),
    labels: true,
    measure: ruler(),
    ...overrides,
  };

  const laid = layoutFrame(input);
  // This helper assumes a frame that can be drawn — the describe block below covers the degenerate case.
  if (laid === null) {
    throw new Error("layoutFrame returned null — a degenerate frame is not what this helper is for");
  }
  return { ...laid, input, xScale };
}

describe("when an axis takes up room and when it does not", () => {
  /** A sparkline — with nothing rendering labels, neither axis takes up room. */
  it("should give the whole area to data when nothing renders labels", () => {
    const { slices } = frame({ labels: false });

    expect(slices.y).toBeNull();
    expect(slices.x).toBeNull();
    expect(slices.data).toEqual(AREA);
  });

  it("should drop the x slice when x labels are off", () => {
    const { slices } = frame({ axis: ax({ x: { showLabels: false } }) });

    expect(slices.x).toBeNull();
    expect(slices.data.bottom).toBe(AREA.bottom);
    // y still takes up its room.
    expect(slices.data.left).toBeGreaterThan(0);
  });

  it("should drop the y slice when every pane hides its labels", () => {
    const { slices } = frame({ axis: ax({ y: { showLabels: false } }) });

    expect(slices.y).toBeNull();
    expect(slices.data.left).toBe(AREA.left);
  });
});

describe("axis size", () => {
  it("should measure the x axis from the font height", () => {
    const { slices } = frame();

    // Text height 10 plus the padding above and below.
    //
    // Stacking `!` onto an optional chain — `slices.x?.bottom!` — means that
    // when the x slice is missing, `undefined - undefined` is NaN and the test
    // goes red **for the wrong reason**. Asserting the absence first makes the
    // failure point at the absence.
    expect(slices.x).toBeDefined();
    expect(slices.x!.bottom - slices.x!.top).toBe(10 + 2 * AXIS_LABEL_OFFSET);
  });

  /** Rounds up by 8px — so the axis doesn't tremble frame to frame while a digit count wobbles during a pan. */
  it("should quantize the y width so it does not jitter", () => {
    const { slices } = frame({ panes: panes(1, [[0, 100]]) });
    const width = slices.y!.right - slices.y!.left;

    expect(width % 8).toBe(0);
    expect(width).toBeGreaterThanOrEqual(2 * AXIS_LABEL_OFFSET);
  });

  it("should widen the y axis for longer labels", () => {
    const narrow = frame({ panes: panes(1, [[0, 1]]) });
    const wide = frame({ panes: panes(1, [[0, 10_000_000]]) });

    const widthOf = (f: typeof narrow) => f.slices.y!.right - f.slices.y!.left;
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
  });

  it("should skip measuring when a fixed size is given", () => {
    const measure = ruler();
    const spy = vi.spyOn(measure, "of");

    const { slices } = frame({
      measure,
      axis: ax({ x: { size: 30 }, y: { size: 64 } }),
    });

    expect(slices.x!.bottom - slices.x!.top).toBe(30);
    expect(slices.y!.right - slices.y!.left).toBe(64);
    expect(spy).not.toHaveBeenCalled();
  });

  it("should fall back to fixed sizes with no measurer", () => {
    const { slices } = frame({ measure: null });

    expect(slices.y!.right - slices.y!.left).toBe(FALLBACK_Y_AXIS_WIDTH);
    expect(slices.x!.bottom - slices.x!.top).toBe(FALLBACK_X_AXIS_HEIGHT);
  });

  it("should put the y axis on the right when asked", () => {
    const { slices } = frame({ axis: ax({ y: { position: "right" } }) });

    expect(slices.data.left).toBe(AREA.left);
    expect(slices.y!.left).toBe(slices.data.right);
  });
});

describe("vertical distribution", () => {
  it("should hand every pane an area and a scale range", () => {
    const list = panes(2);
    const { slices } = frame({ panes: list });

    expect(list[0].area.top).toBe(AREA.top);
    expect(list[1].area.bottom).toBe(slices.data.bottom);
    // Screen y increases downward, so the range is flipped.
    const [bottom, top] = list[0].yScale.getRange();
    expect(bottom).toBeGreaterThan(top);
  });

  it("should split by flex", () => {
    const list = panes(2);
    list[0].applyOptions({ flex: 3 });
    frame({ panes: list });

    const heightOf = (p: Pane) => p.area.bottom - p.area.top;
    expect(heightOf(list[0])).toBeCloseTo(heightOf(list[1]) * 3, 0);
  });

  it("should keep the gap between panes out of every pane", () => {
    const list = panes(2);
    frame({ panes: list, gap: 20 });

    expect(list[1].area.top - list[0].area.bottom).toBe(20);
  });
});

describe("x range is decided after the y-axis width", () => {
  it("should hand the data width to the x scale", () => {
    const { slices, xScale } = frame();

    expect(xScale.getRange()).toEqual([slices.data.left, slices.data.right]);
    expect(slices.data.left).toBeGreaterThan(0);
  });
});

describe("ticks", () => {
  it("should compute x once and y per pane", () => {
    const { ticks } = frame({ panes: panes(2, [[0, 100], [0, 10]]) });

    expect(ticks.x.length).toBeGreaterThan(0);
    expect(ticks.y).toHaveLength(2);
    expect(ticks.y[0].ticks[0].value).not.toBe(ticks.y[1].ticks.at(-1)!.value);
  });

  it("should let a tick strategy own placement and labels", () => {
    const { ticks } = frame({
      axis: ax({ x: { ticks: { ticks: () => [{ value: 42, label: "forty-two" }] } } }),
    });

    expect(ticks.x).toHaveLength(1);
    expect(ticks.x[0].label).toBe("forty-two");
    // The axis fills in position from the scale — the strategy doesn't know about pixels.
    expect(ticks.x[0].position).toBeTypeOf("number");
  });

  /** format receives the data's x even in bar-index coordinates — the format code must stay agnostic to the coordinate system. */
  it("should hand data x to the format in bar-index space", () => {
    const xScale = new LinearScale();
    const x = barIndexX(xScale);
    x.rebuild!([[100, 200, 300, 400, 500]]);
    xScale.setDomain(0, 4);

    const seen: number[] = [];
    const { ticks } = frame({
      xScale,
      x,
      axis: ax({ x: { format: (value) => { seen.push(value); return `x${value}`; } } }),
    });

    expect(ticks.x.length).toBeGreaterThan(0);
    // x 100~500 went into the format, not index 0~4.
    expect(Math.max(...seen)).toBeGreaterThan(4);
    expect(seen.every((value) => value >= 100 && value <= 500)).toBe(true);
  });

  it("should not place bar-index ticks between bars", () => {
    const xScale = new LinearScale();
    const x = barIndexX(xScale);
    x.rebuild!([[100, 200, 300]]);
    xScale.setDomain(0, 2);

    const { ticks } = frame({ xScale, x });

    // A fractional index is empty space between bars, so its label would be an x that has no data.
    expect(ticks.x.every(({ value }) => Number.isInteger(value))).toBe(true);
  });
});

/**
 * A declared option must either be read or absent from the type.
 * Catches AxisOptions.ticks existing in the type for y too while actually
 * being silently ignored.
 */
describe("y-axis tick strategy", () => {
  const fixed = (values: [number, string][]) => ({
    ticks: () => values.map(([value, label]) => ({ value, label })),
  });

  it("should let a strategy own the value axis ticks", () => {
    const { ticks } = frame({
      panes: panes(1, [[0, 100]]),
      axis: ax({ y: { ticks: fixed([[25, "low"], [75, "high"]]) } }),
    });

    expect(ticks.y[0].ticks.map((t) => t.label)).toEqual(["low", "high"]);
  });

  it("should place those ticks with the pane's own scale", () => {
    const list = panes(1, [[0, 100]]);
    const { ticks } = frame({
      panes: list,
      axis: ax({ y: { ticks: fixed([[50, "mid"]]) } }),
    });

    // The axis fills in position from the scale — the strategy doesn't know about pixels.
    expect(ticks.y[0].ticks[0].position).toBeCloseTo(list[0].yScale.scale(50));
  });

  it("should let a pane override the stage-wide strategy", () => {
    const list = panes(2, [[0, 100], [0, 100]]);
    list[1].applyOptions({ axis: { ticks: fixed([[10, "this pane only"]]) } });

    const { ticks } = frame({
      panes: list,
      axis: ax({ y: { ticks: fixed([[50, "stage default"]]) } }),
    });

    expect(ticks.y[0].ticks.map((t) => t.label)).toEqual(["stage default"]);
    expect(ticks.y[1].ticks.map((t) => t.label)).toEqual(["this pane only"]);
  });

  it("should fall back to the axis arithmetic with no strategy", () => {
    const { ticks } = frame({ panes: panes(1, [[0, 100]]) });

    expect(ticks.y[0].ticks.length).toBeGreaterThan(1);
    expect(ticks.y[0].ticks.every((t) => Number.isFinite(t.value))).toBe(true);
  });

  /** The strategy owns the label — if the two mix halfway, nobody knows who's in charge. */
  it("should ignore format when a strategy is present", () => {
    const { ticks } = frame({
      panes: panes(1, [[0, 100]]),
      axis: ax({
        y: { ticks: fixed([[50, "strategy"]]), format: () => "format" },
      }),
    });

    expect(ticks.y[0].ticks[0].label).toBe("strategy");
  });
});

/**
 * The degenerate frame. A collapsing sidebar sweeps its width from 400
 * down to 0, and it used to filter out exactly 0 only, so the values in
 * between leaked into setRange(x, x) and threw a ContractError every
 * frame. The contract is "degenerate means null, and never throws" — the
 * sizes below were measured with this file's own ruler (7px/character),
 * so the exact numbers themselves are not part of the contract.
 */
describe("sizes that cannot be drawn", () => {
  const box = (width: number, height: number): PlotArea => ({
    left: 0,
    right: width,
    top: 0,
    bottom: height,
  });

  function lay(width: number, height: number) {
    const xScale = new LinearScale();
    xScale.setDomain(0, 100);
    return layoutFrame({
      area: box(width, height),
      panes: panes(1),
      gap: 0,
      axis: ax(),
      xScale,
      x: continuousX(xScale),
      labels: true,
      measure: ruler(),
    });
  }

  it.each([
    ["too short vertically", 300, 20],
    ["too narrow horizontally", 40, 300],
    ["both", 40, 20],
    ["1px wide", 1, 300],
    ["3x3", 3, 3],
  ])("should return null when %s (%ix%i)", (_label, width, height) => {
    expect(lay(width, height)).toBeNull();
  });

  it.each([
    ["just above the vertical floor", 300, 25],
    ["just above the horizontal floor", 50, 300],
    ["small but drawable", 60, 30],
  ])("should still lay out %s (%ix%i)", (_label, width, height) => {
    expect(lay(width, height)).not.toBeNull();
  });

  /** **Never throws** — a size mid-transition is not a programmer error. */
  it("should never throw on a degenerate size", () => {
    for (const [w, h] of [[3, 3], [1, 300], [300, 20], [40, 300], [2, 2]]) {
      expect(() => lay(w, h)).not.toThrow();
    }
  });

  /** The vertical check runs before the first assignment, so the x scale is never touched — it used to throw from yScale.setRange(0, 0) before the check ran. */
  it("should leave the x scale range untouched when it bails", () => {
    const xScale = new LinearScale();
    xScale.setDomain(0, 100);
    xScale.setRange(10, 790);

    layoutFrame({
      area: box(3, 3),
      panes: panes(1),
      gap: 0,
      axis: ax(),
      xScale,
      x: continuousX(xScale),
      labels: true,
      measure: ruler(),
    });

    expect(xScale.getRange()).toEqual([10, 790]);
  });

  /**
   * One collapsed pane must not take the rest down with it. The check was
   * heights.some(h => h < 1), and giving flex: 0 and minHeight: 0 together
   * (both individually valid values) made the height exactly 0, wiping out
   * the whole chart.
   */
  it("should still lay out when one pane is collapsed to nothing", () => {
    const [main, collapsed] = panes(2);
    collapsed.applyOptions({ flex: 0, minHeight: 0 });

    const xScale = new LinearScale();
    xScale.setDomain(0, 100);
    const result = layoutFrame({
      area: box(800, 600),
      panes: [main, collapsed],
      gap: 0,
      axis: ax(),
      xScale,
      x: continuousX(xScale),
      labels: true,
      measure: ruler(),
    });

    expect(result).not.toBeNull();

    // Even the collapsed side must end up with a valid range — setRange(x, x) is a contract violation.
    const [collapsedStart, collapsedEnd] = collapsed.yScale.getRange();
    expect(collapsedStart).not.toBe(collapsedEnd);

    // And the surviving side takes up nearly all the space.
    const [mainStart, mainEnd] = main.yScale.getRange();
    expect(Math.abs(mainStart - mainEnd)).toBeGreaterThan(400);
  });

  /**
   * A collapsed pane must not contribute to the axis width. The 1px floor
   * exists so a range can be established, not so it can be "shown" — if
   * it isn't filtered out, a collapsed pane's tick labels would still set
   * the shared y-axis width, so collapsing it narrows the chart instead.
   */
  it("should not let a collapsed pane widen the shared y axis", () => {
    const xScale = new LinearScale();
    xScale.setDomain(0, 100);
    const lay = (collapse: boolean) => {
      const [main, other] = panes(2, [
        [0, 100],
        [12_345_678, 12_456_789],
      ]);
      if (collapse) other.applyOptions({ flex: 0, minHeight: 0 });
      const result = layoutFrame({
        area: box(800, 600),
        panes: [main, other],
        gap: 0,
        axis: ax(),
        xScale,
        x: continuousX(xScale),
        labels: true,
        measure: ruler(),
      });
      if (result === null) throw new Error("no frame");
      return result;
    };

    const collapsed = lay(true);
    const expanded = lay(false);

    /**
     * The claim is not "narrower or equal" but "the same as if it weren't
     * there." toBeLessThanOrEqual(expanded) had zero discriminating power
     * — since the baseline leaves the large-domain pane expanded, both the
     * buggy version and the fixed version passed it. So compare instead
     * against a layout where that pane doesn't exist at all.
     */
    const xScale2 = new LinearScale();
    xScale2.setDomain(0, 100);
    const [only] = panes(1, [[0, 100]]);
    const absent = layoutFrame({
      area: box(800, 600),
      panes: [only],
      gap: 0,
      axis: ax(),
      xScale: xScale2,
      x: continuousX(xScale2),
      labels: true,
      measure: ruler(),
    });
    if (absent === null) throw new Error("no frame");

    expect(collapsed.slices.data.left).toBe(absent.slices.data.left);
    // Left expanded, that label does actually widen it — showing the assertion above isn't a freebie.
    expect(expanded.slices.data.left).toBeGreaterThan(absent.slices.data.left);

    // And the collapsed pane doesn't put up labels.
    expect(collapsed.ticks.y[1].showLabels).toBe(false);
  });

  /** The other side is unchanged — a transition where the stage height vanishes entirely still bails out of the frame. */
  it("should still bail when every pane is degenerate", () => {
    const xScale = new LinearScale();
    xScale.setDomain(0, 100);
    const result = layoutFrame({
      area: box(800, 3),
      panes: panes(2),
      gap: 0,
      axis: ax(),
      xScale,
      x: continuousX(xScale),
      labels: true,
      measure: ruler(),
    });

    expect(result).toBeNull();
  });
});
