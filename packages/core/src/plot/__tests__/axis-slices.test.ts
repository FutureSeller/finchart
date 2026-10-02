import { describe, expect, it } from "vitest";
import type { AxisLabelsInput } from "../../axis";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { lineSeries } from "../../series";
import { FALLBACK_X_AXIS_HEIGHT, FALLBACK_Y_AXIS_WIDTH, sliceAxes } from "../layout";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** Captures the area received on draw. */
function spySeries(): Series<LineDataPoint> & {
  seen: SeriesContext<LineDataPoint>[];
} {
  const seen: SeriesContext<LineDataPoint>[] = [];

  return {
    seen,
    valueExtent: () => ({ min: 0, max: 100 }),
    draw(_renderer: CanvasRenderer, context: SeriesContext<LineDataPoint>) {
      seen.push(context);
    },
  };
}

/** Captures the input the label renderer received. */
function labelSpy() {
  const seen: AxisLabelsInput[] = [];

  return {
    seen,
    createAxisLabels: () => ({
      render: (input: AxisLabelsInput) => {
        seen.push(input);
      },
      clear: () => undefined,
      destroy: () => undefined,
    }),
  };
}

const { padding } = defaultConfig;

describe("axis slices", () => {
  it("should fall back to fixed sizes without a measurer", () => {
    const series = spySeries();
    const { handle } = mountPlot({
      deps: { ...testBrowserDeps(), createTextMeasurer: undefined },
      series,
    });
    handle.setData(data);

    const area = series.seen.at(-1)!.area;
    expect(area.left).toBe(padding.left + FALLBACK_Y_AXIS_WIDTH);
    expect(area.bottom).toBe(
      defaultSize.height - padding.bottom - FALLBACK_X_AXIS_HEIGHT,
    );
    // No axis on the right or top — only padding bounds those edges.
    expect(area.right).toBe(defaultSize.width - padding.right);
    expect(area.top).toBe(padding.top);
  });

  it("should follow the widest measured label", () => {
    const series = spySeries();
    const deps = testBrowserDeps({
      // 10px per character, 10px height — a measurer whose output you can compute by hand.
      createTextMeasurer: () => ({
        measure: (text: string) => ({ width: text.length * 10, height: 10 }),
      }),
    });
    const { handle } = mountPlot({
      deps,
      series,
      config: {
        ...defaultConfig,
        // Fix the label to a constant width to make measurement deterministic.
        axis: { y: { format: () => "####" } },
      },
    });
    handle.setData(data);

    const area = series.seen.at(-1)!.area;
    // y: "####" 40px + 12px margin = 52 -> rounds up by 8px = 56.
    expect(area.left).toBe(padding.left + 56);
    // x: 10px height + 12px margin = 22.
    expect(area.bottom).toBe(defaultSize.height - padding.bottom - 22);
  });

  it("should not tremble while the label widths wobble inside one step", () => {
    const series = spySeries();
    const deps = testBrowserDeps({
      createTextMeasurer: () => ({
        measure: (text: string) => ({ width: text.length * 3, height: 10 }),
      }),
    });
    const { plot, handle } = mountPlot({
      deps,
      series,
      config: { ...defaultConfig, axis: { y: { format: () => "##" } } },
    });
    handle.setData(data);
    const before = series.seen.at(-1)!.area.left;

    // The label grew from 6px to 9px, but it's still the same 8px bucket — the axis doesn't move.
    plot.applyOptions({ axis: { y: { format: () => "###" } } });

    expect(series.seen.at(-1)!.area.left).toBe(before);
  });

  it("should hand the label renderer its slices", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { handle } = mountPlot({ deps, series: lineSeries() });
    handle.setData(data);

    const { axes, area } = spy.seen.at(-1)!;
    expect(axes.y).toEqual({
      left: padding.left,
      right: area.left,
      top: padding.top,
      bottom: area.bottom,
    });
    expect(axes.x).toEqual({
      left: area.left,
      right: defaultSize.width - padding.right,
      top: area.bottom,
      bottom: defaultSize.height - padding.bottom,
    });
  });

  it("should give no room to an axis whose labels are off", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { handle } = mountPlot({
      deps,
      series: lineSeries(),
      config: { ...defaultConfig, axis: { x: { showLabels: false } } },
    });
    handle.setData(data);

    const { axes, area } = spy.seen.at(-1)!;
    expect(axes.x).toBeNull();
    expect(area.bottom).toBe(defaultSize.height - padding.bottom);
    // y still has its slot.
    expect(axes.y).not.toBeNull();
  });

  it("should give no room at all without a label collaborator", () => {
    const series = spySeries();
    const deps = { ...testBrowserDeps(), createAxisLabels: undefined };
    const { handle } = mountPlot({ deps, series });
    handle.setData(data);

    expect(series.seen.at(-1)!.area).toEqual({
      left: padding.left,
      right: defaultSize.width - padding.right,
      top: padding.top,
      bottom: defaultSize.height - padding.bottom,
    });
  });
});

describe("sliceAxes", () => {
  const area = { left: 10, right: 210, top: 20, bottom: 120 };

  it("should return null slices for zero sizes", () => {
    const slices = sliceAxes(area, { yWidth: 0, xHeight: 0 });

    expect(slices.y).toBeNull();
    expect(slices.x).toBeNull();
    expect(slices.data).toEqual(area);
  });

  it("should keep the corner out of both slices", () => {
    const { x, y, data: rest } = sliceAxes(area, { yWidth: 40, xHeight: 20 });

    // The y axis only runs down to the data area's height, and the x axis
    // only starts at the data area's left — the corner belongs to neither.
    expect(y!.bottom).toBe(rest.bottom);
    expect(x!.left).toBe(rest.left);
  });

  it("should lose to the container when it is too small", () => {
    const tiny = { left: 0, right: 30, top: 0, bottom: 10 };

    const { data: rest } = sliceAxes(tiny, { yWidth: 48, xHeight: 24 });

    // A negative data area flips the scale range — clamp at 0 instead.
    expect(rest.right - rest.left).toBeGreaterThanOrEqual(0);
    expect(rest.bottom - rest.top).toBeGreaterThanOrEqual(0);
  });
});

describe("y-axis right placement and fixed size (2.2)", () => {
  it("should carve the y slice on the right when asked", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { handle } = mountPlot({
      deps,
      series: lineSeries(),
      config: {
        ...defaultConfig,
        axis: { y: { position: "right" }, x: { showLabels: false } },
      },
    });
    handle.setData(data);

    const { axes, area } = spy.seen.at(-1)!;
    // The y slice sits to the right of the data area.
    expect(axes.y!.left).toBe(area.right);
    expect(axes.y!.right).toBe(defaultSize.width - padding.right);
    expect(area.left).toBe(padding.left);
  });

  it("should skip measurement when a fixed size is given", () => {
    const series = spySeries();
    const deps = testBrowserDeps({
      createTextMeasurer: () => ({
        measure: () => {
          throw new Error("a fixed size must not trigger measurement");
        },
      }),
    });
    const { handle } = mountPlot({
      deps,
      series,
      config: {
        ...defaultConfig,
        axis: { y: { size: 72 }, x: { size: 30 } },
      },
    });
    handle.setData(data);

    const area = series.seen.at(-1)!.area;
    expect(area.left).toBe(padding.left + 72);
    expect(area.bottom).toBe(defaultSize.height - padding.bottom - 30);
  });
});

describe("value axis toggle (2.2)", () => {
  it("should flip the picture when inverted", async () => {
    const { createPlotModel } = await import("../model");
    const series = spySeries();
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series, data },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    model.plot.render();
    const normal = model.plot.mainPane.yScale.scale(20);

    model.plot.mainPane.applyOptions({ invert: true });
    model.plot.render();
    const inverted = model.plot.mainPane.yScale.scale(20);

    // Inverted means larger values go lower — the same value's screen y flips to the other side.
    const { area } = model.plot.mainPane;
    expect(normal - area.top).toBeCloseTo(area.bottom - inverted, 6);
    // The pane reports it.
    expect(model.plot.mainPane.invert).toBe(true);
  });

  it("should carry the viewing domain across a scale swap", async () => {
    const { createPlotModel } = await import("../model");
    const { LogScale } = await import("../../scale");
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    model.plot.render();
    const viewing = model.plot.mainPane.yScale.getDomain();

    model.plot.mainPane.setYScale(new LogScale());
    model.plot.render();

    const [min, max] = model.plot.mainPane.yScale.getDomain();

    /** Not losing the visible range — this checks "does the swap reset the
     * view", not an exact value match. */
    expect(min).toBeGreaterThan(0); // log's positive-only contract
    expect(min).toBeLessThan(10); // covers the data's lower bound (10)
    expect(max).toBeGreaterThan(20); // covers the data's upper bound (20)
    // It didn't snap back to the full range — it's near the same spot.
    expect(min).toBeCloseTo(viewing[0], 0);
  });
});

describe("axis drag scaling (2.2)", () => {
  async function dragModel() {
    const { createPlotModel } = await import("../model");
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.render();
    const route = (
      type: "pointerdown" | "pointermove" | "pointerup",
      point: { x: number; y: number },
    ) => model.plot.routeInput({ type, point, pointerId: 1 });
    return { model, route };
  }

  it("should stretch the pane's value axis from its y slice", async () => {
    const { model, route } = await dragModel();
    const pane = model.plot.mainPane;
    const before = pane.yScale.getDomain();
    const grab = { x: 10, y: (pane.area.top + pane.area.bottom) / 2 };

    expect(route("pointerdown", grab)).toBe(true);
    route("pointermove", { x: 10, y: grab.y + 60 });
    route("pointerup", { x: 10, y: grab.y + 60 });

    const after = pane.yScale.getDomain();
    // Dragged downward — the range widens (zooms out) and becomes a manually set range.
    expect(after[1] - after[0]).toBeGreaterThan(before[1] - before[0]);
    expect(pane.autoScale).toBe(false);
    // x domain is unchanged — this isn't a pan.
  });

  it("should zoom x from the x slice and leave tools first", async () => {
    const { model, route } = await dragModel();
    const xBefore = model.plot.getVisibleRange()!;
    const { area } = model.plot.mainPane;
    const grab = { x: (area.left + area.right) / 2, y: 595 };

    expect(route("pointerdown", grab)).toBe(true);
    route("pointermove", { x: grab.x + 80, y: 595 });
    route("pointerup", { x: grab.x + 80, y: 595 });

    const xAfter = model.plot.getVisibleRange()!;
    // Dragged to the right — the window narrows (zooms in).
    expect(xAfter.max - xAfter.min).toBeLessThan(xBefore.max - xBefore.min);
  });
});

describe("axis drag on a log value axis", () => {
  async function logDrag(dy: number) {
    const { createPlotModel } = await import("../model");
    const { LogScale } = await import("../../scale");
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: Array.from({ length: 100 }, (_, i) => ({ x: i, y: 10 * 1.05 ** i })),
      },
      config: { showGrid: false },
    });
    const pane = model.plot.mainPane;
    pane.setYScale(new LogScale());
    model.plot.render();
    const before = pane.yScale.getDomain();
    const grab = { x: 10, y: (pane.area.top + pane.area.bottom) / 2 };
    model.plot.routeInput({ type: "pointerdown", point: grab, pointerId: 1 });
    for (let moved = 5; moved <= Math.abs(dy); moved += 5) {
      model.plot.routeInput({ type: "pointermove", point: { x: 10, y: grab.y + Math.sign(dy) * moved }, pointerId: 1 });
    }
    model.plot.routeInput({ type: "pointerup", point: { x: 10, y: grab.y + dy }, pointerId: 1 });
    return { before, after: pane.yScale.getDomain() };
  }

  const decades = ([min, max]: [number, number]) => Math.log10(max / min);
  const middle = ([min, max]: [number, number]) => Math.sqrt(min * max);

  it("zooms out when dragged down", async () => {
    const { before, after } = await logDrag(50);

    expect(decades(after)).toBeGreaterThan(decades(before));
    expect(middle(after) / middle(before)).toBeCloseTo(1, 9);
  });

  it("zooms in around the middle of the screen when dragged up", async () => {
    const { before, after } = await logDrag(-50);

    expect(decades(after)).toBeLessThan(decades(before));
    expect(middle(after) / middle(before)).toBeCloseTo(1, 9);
  });
});
