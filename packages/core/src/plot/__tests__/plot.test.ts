import { describe, expect, it } from "vitest";
import {
  axisLabels,
  axisLabelsSpy,
  filledCircles,
  strokedPaths,
  type FakeLayers,
} from "../../__tests__/dom-fakes";
import { Axis, createCanvasAxisLabels } from "../../axis";
import type { LineDataPoint } from "../../data";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { testBrowserDeps, testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { DEFAULT_PLOT_STYLE } from "../style";
import { defaultConfig, defaultSize, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10, label: "Jan" },
  { x: 25, y: 20, label: "Feb" },
  { x: 50, y: 15, label: "Mar" },
  { x: 75, y: 30, label: "Apr" },
  { x: 100, y: 25, label: "May" },
];

const mount = (config = defaultConfig) =>
  mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config });

function dataLine(layers: FakeLayers) {
  const path = strokedPaths(layers.context).find(
    (p) => p.width === DEFAULT_LINE_STYLE.line.width,
  );
  if (!path) throw new Error("no data line was drawn");
  return path;
}

const gridPaths = (layers: FakeLayers) =>
  strokedPaths(layers.context).filter(
    (p) => p.width === DEFAULT_PLOT_STYLE.grid.width,
  );

describe("Plot", () => {
  it("should copy data instead of aliasing the caller's array", () => {
    const { plot, handle, layers } = mount();
    const input = [...data];

    handle.setData(input);
    input.push({ x: 200, y: 999 });
    plot.render();

    // A mutation made after handing the array off does not show up in what's drawn.
    expect(handle.xRange).toEqual({ min: 0, max: 100 });
    expect(dataLine(layers).points).toHaveLength(data.length);
  });

  it("should emit render once per data change", () => {
    const { plot, handle } = mount();

    let renders = 0;
    plot.on("render", () => renders++);
    handle.setData(data);

    expect(renders).toBe(1);
  });

  it("should emit render even when there is nothing to draw", () => {
    // Empty data is still a frame — clearing the axis labels is that frame's job.
    const { plot, handle } = mount();

    let renders = 0;
    plot.on("render", () => renders++);
    handle.setData([]);

    expect(renders).toBe(1);
  });

  it("should stop notifying after the unsubscribe callback runs", () => {
    const { plot, handle } = mount();

    let calls = 0;
    const off = plot.on("render", () => calls++);

    handle.setData(data);
    off();
    handle.setData(data);

    expect(calls).toBe(1);
  });

  it("should paint the series onto the 2d context", () => {
    const { handle, layers } = mount();

    handle.setData(data);

    expect(dataLine(layers).points).toHaveLength(data.length);
    expect(filledCircles(layers.context)).toHaveLength(data.length);
  });

  it("should clear the surface at the start of every redraw", () => {
    const { handle, layers } = mount();

    handle.setData(data);

    expect(layers.context.calls[0].method).toBe("clearRect");
  });

  it("should tear down its layers on destroy", () => {
    const { plot, handle, layers } = mount();

    handle.setData(data);
    plot.destroy();

    expect(layers.destroyed).toBe(true);
  });
});

describe("layers", () => {
  it("should expose an overlay for annotations", () => {
    const { plot, layers } = mount();

    expect(plot.overlay).toBe(layers.overlay);
  });

  it("should keep the same overlay across redraws and resizes", () => {
    const { plot, handle, layers } = mount();
    const before = plot.overlay;

    handle.setData(data);
    plot.setViewport({ width: 400 });

    expect(plot.overlay).toBe(before);
    expect(layers.destroyed).toBe(false);
  });

  it("should take its size from the layers", () => {
    const { plot, handle, layers } = mount();

    handle.setData(data);
    plot.setViewport({ width: 400, height: 300 });

    expect(layers.data.width).toBe(400);
    expect(dataLine(layers).points.at(-1)?.x).toBeCloseTo(
      400 - defaultConfig.padding.right,
    );
  });

  it("should keep the untouched dimension on a partial resize", () => {
    const { plot, layers } = mount();

    plot.setViewport({ width: 400 });

    expect(layers.data.width).toBe(400);
    expect(layers.data.height).toBe(600);
  });
});

describe("coordinate transform", () => {
  // Tests only the coordinate transform — with labels off, the axis slice
  // is zero, so padding alone forms the boundary. axis-slices.test.ts
  // covers the geometry when a slice exists.
  const bare = {
    ...defaultConfig,
    axis: { x: { showLabels: false }, y: { showLabels: false } },
  };

  it("should keep x inside the plot area regardless of the data range", () => {
    const { handle, layers } = mount(bare);

    handle.setData([
      { x: 0, y: 0 },
      { x: 5000, y: 5 },
      { x: 10000, y: 10 },
    ]);

    const { points } = dataLine(layers);

    expect(points[0].x).toBeCloseTo(defaultConfig.padding.left);
    expect(points[2].x).toBeCloseTo(
      defaultSize.width - defaultConfig.padding.right,
    );
  });

  it("should place larger values higher on screen", () => {
    const { handle, layers } = mount();

    handle.setData([
      { x: 0, y: 10 },
      { x: 50, y: 30 },
      { x: 100, y: 20 },
    ]);

    const [low, high, mid] = dataLine(layers).points;

    expect(high.y).toBeLessThan(mid.y);
    expect(mid.y).toBeLessThan(low.y);
  });

  it("should keep y inside the plot area", () => {
    const { handle, layers } = mount();

    handle.setData([
      { x: 0, y: -500 },
      { x: 100, y: 500 },
    ]);

    for (const point of dataLine(layers).points) {
      expect(point.y).toBeGreaterThanOrEqual(defaultConfig.padding.top);
      expect(point.y).toBeLessThanOrEqual(
        defaultSize.height - defaultConfig.padding.bottom,
      );
    }
  });

  it("should handle a flat series without collapsing the domain", () => {
    const { handle, layers } = mount();

    expect(() =>
      handle.setData([
        { x: 0, y: 7 },
        { x: 100, y: 7 },
      ]),
    ).not.toThrow();

    const { points } = dataLine(layers);
    expect(points[0].y).toBeCloseTo(points[1].y);
  });
});

describe("grid composition", () => {
  it("should place grid lines exactly on the axis ticks", () => {
    const { deps, xScale, yScale } = testBrowserDepsWithScales();
    const { handle, layers } = mountPlot({ deps, series: lineSeries() });

    handle.setData([
      { x: 0, y: 3 },
      { x: 37, y: 91 },
      { x: 64, y: 12 },
    ]);

    const axisConfig = {};
    const paths = gridPaths(layers);
    const verticals = paths
      .filter(({ points }) => points[0].x === points[1].x)
      .map(({ points }) => points[0].x);
    const horizontals = paths
      .filter(({ points }) => points[0].y === points[1].y)
      .map(({ points }) => points[0].y);

    const xTicks = new Axis(xScale, "horizontal", axisConfig).getTicks();
    const yTicks = new Axis(yScale, "vertical", axisConfig).getTicks();

    expect(verticals).toEqual(xTicks.map((t) => t.position));
    expect(horizontals).toEqual(yTicks.map((t) => t.position));
  });

  it("should draw the grid behind the series", () => {
    const { handle, layers } = mount();

    handle.setData(data);

    const paths = strokedPaths(layers.context);
    const firstSeries = paths.findIndex(
      (p) => p.width === DEFAULT_LINE_STYLE.line.width,
    );
    const lastGrid = paths.findLastIndex(
      (p) => p.width === DEFAULT_PLOT_STYLE.grid.width,
    );

    expect(lastGrid).toBeLessThan(firstSeries);
  });

  it("should draw no grid when disabled", () => {
    const { handle, layers } = mount({ ...defaultConfig, showGrid: false });

    handle.setData(data);

    expect(gridPaths(layers)).toHaveLength(0);
    expect(dataLine(layers).points).toHaveLength(data.length);
  });
});

describe("config updates", () => {
  it("should toggle the grid without recreating the canvas", () => {
    const { plot, handle, layers } = mount();
    handle.setData(data);

    const overlay = plot.overlay;
    const surface = layers.data;

    plot.applyOptions({ showGrid: false });

    expect(gridPaths(layers)).toHaveLength(0);
    // Both the canvas and the overlay must be unchanged.
    expect(layers.destroyed).toBe(false);
    expect(plot.overlay).toBe(overlay);
    expect(layers.data).toBe(surface);
  });

  it("should keep drawing the series after a grid toggle", () => {
    const { plot, handle, layers } = mount();
    handle.setData(data);

    plot.applyOptions({ showGrid: false });

    expect(dataLine(layers).points).toHaveLength(data.length);
  });

  it("should keep the pan position across a config change", () => {
    const { deps, xScale } = testBrowserDepsWithScales();
    const { plot } = mountPlot({ deps, series: lineSeries(), data });

    plot.pan(30);
    const panned = xScale.getDomain();
    plot.applyOptions({ showGrid: false });

    expect(xScale.getDomain()).toEqual(panned);
  });

  it("should bring the grid back when re-enabled", () => {
    const { plot, handle, layers } = mount();
    handle.setData(data);

    plot.applyOptions({ showGrid: false });
    plot.applyOptions({ showGrid: true });

    expect(gridPaths(layers).length).toBeGreaterThan(0);
  });

  it("should apply a new grid style", () => {
    const { plot, handle, layers } = mount();
    handle.setData(data);

    plot.applyOptions({ style: { grid: { width: 3, color: "#ff00ff" } } });

    const grid = strokedPaths(layers.context).filter((p) => p.width === 3);
    expect(grid.length).toBeGreaterThan(0);
    expect(grid[0].color).toBe("#ff00ff");
  });

  it("should leave untouched config keys alone", () => {
    const { plot } = mount();

    plot.applyOptions({ showGrid: false });

    expect(plot.getOptions().padding).toEqual(defaultConfig.padding);
  });

  /** With a shallow copy, a nested field was the same object as the internal one, so whoever read it could mutate the stage without any notification. */
  it("should hand out a copy, not the live config", () => {
    const { plot } = mount();
    plot.applyOptions({
      axis: { x: { showLabels: false } },
      style: { grid: { width: 1, color: "#111" } },
    });

    const taken = plot.getOptions();
    taken.padding.left = 999;
    taken.axis!.x!.showLabels = true;
    taken.style!.grid!.color = "#fff";

    const after = plot.getOptions();
    expect(after.padding.left).toBe(defaultConfig.padding.left);
    expect(after.axis?.x?.showLabels).toBe(false);
    expect(after.style?.grid?.color).toBe("#111");
  });

  it("should re-render on a padding change", () => {
    const { plot, handle, layers } = mount({
      ...defaultConfig,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    });
    handle.setData(data);

    plot.applyOptions({ padding: { top: 50, right: 50, bottom: 50, left: 50 } });

    expect(dataLine(layers).points[0].x).toBeCloseTo(50);
  });
});

describe("axis labels", () => {
  // Assert against the input the core hands the renderer, not the label
  // implementation (@finchart/dom / canvas) — tick content and position are the core's job.
  const mountLabeled = (config = defaultConfig) => {
    const axisSpy = axisLabelsSpy();
    const deps = testBrowserDeps({
      createAxisLabels: axisSpy.createAxisLabels,
    });
    return {
      ...mountPlot({ deps, series: lineSeries(), config }),
      axisSpy,
    };
  };

  it("should hand ticks to the label renderer", () => {
    const { handle, axisSpy } = mountLabeled();
    handle.setData(data);

    expect(axisSpy.input().x.length).toBeGreaterThan(0);
    expect(axisSpy.input().y.length).toBeGreaterThan(0);
  });

  it("should label the same positions as the grid lines", () => {
    const { handle, layers, axisSpy } = mountLabeled();
    handle.setData(data);

    const verticals = gridPaths(layers)
      .filter(({ points }) => points[0].x === points[1].x)
      .map(({ points }) => points[0].x);
    const xLabels = axisSpy.input().x.map((tick) => tick.position);

    expect(xLabels).toEqual(verticals);
  });

  it("should drop labels when disabled", () => {
    const { plot, handle, axisSpy } = mountLabeled();
    handle.setData(data);

    plot.applyOptions({ axis: { x: { showLabels: false }, y: { showLabels: false } } });

    expect(axisSpy.xTexts()).toHaveLength(0);
    expect(axisSpy.yTexts()).toHaveLength(0);
  });

  it("should still label when the grid is off", () => {
    const { handle, axisSpy } = mountLabeled({
      ...defaultConfig,
      showGrid: false,
    });
    handle.setData(data);

    expect(axisSpy.input().x.length).toBeGreaterThan(0);
  });

  it("should apply a custom format", () => {
    const { handle, axisSpy } = mountLabeled({
      ...defaultConfig,
      axis: { y: { format: (v: number) => `$${v.toFixed(0)}` } },
    });
    handle.setData(data);

    expect(axisSpy.yTexts().some((t) => t.startsWith("$"))).toBe(true);
  });

  it("should clear labels for empty data", () => {
    const { handle, axisSpy } = mountLabeled();

    handle.setData(data);
    handle.setData([]);

    expect(axisSpy.xTexts()).toHaveLength(0);
    expect(axisSpy.yTexts()).toHaveLength(0);
  });

  it("should put every label on the canvas when wired with the canvas path", () => {
    const deps = testBrowserDeps({ createAxisLabels: createCanvasAxisLabels });
    const { handle, layers } = mountPlot({ deps, series: lineSeries() });
    handle.setData(data);

    const calls = layers.context.calls;
    const texts = calls.filter((call) => call.method === "fillText");
    expect(texts.length).toBeGreaterThan(0);
    // The overlay is empty — everything is drawn on one surface (a precondition for the screenshot).
    expect(axisLabels(layers.overlay)).toHaveLength(0);
    // Labels come after the drawing — a series that bleeds into the axis area can't cover a label.
    const lastStroke = calls.findLastIndex((call) => call.method === "stroke");
    const firstText = calls.findIndex((call) => call.method === "fillText");
    expect(firstText).toBeGreaterThan(lastStroke);
  });

  it("should update labels after a pan", () => {
    const { plot, handle, axisSpy } = mountLabeled();
    handle.setData(data);

    const before = axisSpy.xTexts();
    plot.pan(37);

    expect(axisSpy.xTexts()).not.toEqual(before);
  });
});

describe("takeScreenshot (2.5)", () => {
  it("should render a fresh frame and hand out the layer's pixels", () => {
    const deps = testBrowserDeps();
    const factory = { taken: 0 };
    const { plot, handle, layers } = mountPlot({ deps, series: lineSeries() });
    // Plant the capability on the fake layers — the layers own the pixels.
    (layers as unknown as { screenshot(): string }).screenshot = () => {
      factory.taken++;
      return "data:image/png;base64,fake";
    };
    handle.setData(data);

    let renders = 0;
    plot.on("render", () => renders++);

    expect(plot.takeScreenshot()).toContain("data:image/png");
    expect(factory.taken).toBe(1);
    // A frame is drawn fresh right before taking the shot — not a stale scheduled one.
    expect(renders).toBe(1);
  });

  it("should refuse when the layers have no pixels", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries() });

    expect(() => plot.takeScreenshot()).toThrow(/headless/);
  });
});
