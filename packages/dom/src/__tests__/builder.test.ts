import { describe, expect, it } from "vitest";
import {
  axisLabels,
  fakeContainer,
  fakeLayersFactory,
  filledCircles,
  strokedPaths,
} from "./fakes";
import { candleSeries, createScope, lineSeries, DEFAULT_LINE_STYLE } from "@finchart/core";
import { PlotBuilder } from "../builder";
import { testBrowserDeps } from "./fakes";
import { DEFAULT_PLOT_STYLE } from "@finchart/core";

const series = [
  { x: 0, y: 10 },
  { x: 100, y: 20 },
];

function withFakeLayers<D extends { createLayers: unknown }>(deps: D) {
  const factory = fakeLayersFactory();
  return { deps: { ...deps, createLayers: factory.createLayers }, factory };
}

describe("PlotBuilder", () => {
  it("appends a large batch without exceeding the engine argument limit", () => {
    const points = Array.from({ length: 200_000 }, (_, i) => ({ x: i + 1, y: i }));
    const { deps } = withFakeLayers(testBrowserDeps());
    const plot = PlotBuilder.create(deps, lineSeries())
      .addDataPoint({ x: 0, y: -1 })
      .addDataPoints(points)
      .addDataPoint({ x: 200_001, y: 200_000 })
      .build(fakeContainer());
    try {
      expect(plot.mainPane.xRange()).toEqual({ min: 0, max: 200_001 });
      expect(plot.mainPane.probe(100_000)[0].value).toBe(99_999);
    } finally {
      plot.destroy();
    }
  });

  it("should hand the chart to a parent scope via setScope", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());
    const page = createScope();

    const plot = PlotBuilder.create(deps, lineSeries())
      .addDataPoints(series)
      .setScope(page)
      .build(fakeContainer());

    page.dispose();

    // The parent's dispose is the chart's destroy — same door as
    // PlotOptions.scope, reached without leaving the builder.
    expect(factory.created[0].destroyed).toBe(true);
    expect(() => plot.destroy()).not.toThrow();
  });

  it("should build a plot from deps and a series", () => {
    const { deps } = withFakeLayers(testBrowserDeps());

    const plot = PlotBuilder.create(deps, lineSeries())
      .addDataPoints(series)
      .build(fakeContainer());

    // Data belongs to the registration, not the stage — verified via the pane's drawn range.
    expect(plot.mainPane.xRange()).toEqual({
      min: series[0].x,
      max: series[1].x,
    });
  });

  it("should infer the data type from deps and series together", () => {
    const { deps } = withFakeLayers(testBrowserDeps());

    const plot = PlotBuilder.create(deps, candleSeries())
      .addDataPoint({ x: 0, open: 1, high: 5, low: 0, close: 4 })
      .build(fakeContainer());

    // If the type weren't inferred as OHLC, the addDataPoint call above wouldn't compile.
    expect(plot.mainPane.xRange()).toEqual({ min: 0, max: 0 });
  });

  it("should use the requested size for the layers", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries())
      .setSize(640, 480)
      .addDataPoints(series)
      .build(fakeContainer());

    expect(factory.created[0].data.width).toBe(640);
    expect(factory.created[0].data.height).toBe(480);
  });

  it("should carry showGrid into the plot", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries())
      .setShowGrid(false)
      .addDataPoints(series)
      .build(fakeContainer());

    const grid = strokedPaths(factory.created[0].context).filter(
      (p) => p.width === DEFAULT_PLOT_STYLE.grid.width,
    );
    expect(grid).toHaveLength(0);
  });

  it("should carry grid style overrides", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries())
      .setGridStyle({ width: 1.5, color: "#abcdef" })
      .addDataPoints(series)
      .build(fakeContainer());

    const grid = strokedPaths(factory.created[0].context).filter(
      (p) => p.width === 1.5,
    );
    expect(grid.length).toBeGreaterThan(0);
    expect(grid[0].color).toBe("#abcdef");
  });

  it("should take series style from the series, not the builder", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(
      deps,
      lineSeries({ point: { radius: 8, color: "#c0ffee" } }),
    )
      .addDataPoints(series)
      .build(fakeContainer());

    expect(filledCircles(factory.created[0].context)[0]).toMatchObject({
      r: 8,
      fill: "#c0ffee",
    });
  });

  it("should build an empty plot without drawing a series", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    const plot = PlotBuilder.create(deps, lineSeries()).build(fakeContainer());

    expect(plot.mainPane.xRange()).toBeNull();
    expect(strokedPaths(factory.created[0].context)).toHaveLength(0);
  });

  it("should keep the default line width when only color is overridden", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries({ line: { color: "#ff0000" } }))
      .addDataPoints(series)
      .build(fakeContainer());

    const line = strokedPaths(factory.created[0].context).find(
      (p) => p.color === "#ff0000",
    );
    expect(line?.width).toBe(DEFAULT_LINE_STYLE.line.width);
  });
});

describe("PlotBuilder config", () => {
  it("should carry padding into the plot", () => {
    const { deps } = withFakeLayers(testBrowserDeps());
    const padding = { top: 10, right: 10, bottom: 10, left: 60 };

    const plot = PlotBuilder.create(deps, lineSeries())
      .setPadding(padding)
      .addDataPoints(series)
      .build(fakeContainer());

    expect(plot.getOptions().padding).toEqual(padding);
  });

  it("should toggle axis labels off", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries())
      .setShowAxisLabels(false)
      .addDataPoints(series)
      .build(fakeContainer());

    expect(axisLabels(factory.created[0].overlay)).toHaveLength(0);
  });

  it("should apply a tick format", () => {
    const { deps, factory } = withFakeLayers(testBrowserDeps());

    PlotBuilder.create(deps, lineSeries())
      .setFormat({ y: (v) => `${v}won` })
      .addDataPoints(series)
      .build(fakeContainer());

    const texts = axisLabels(factory.created[0].overlay).map(
      (el) => el.textContent,
    );
    expect(texts.some((t) => t.endsWith("won"))).toBe(true);
  });

  it("should merge successive setFormat calls", () => {
    const { deps } = withFakeLayers(testBrowserDeps());

    const plot = PlotBuilder.create(deps, lineSeries())
      .setFormat({ x: (v) => `x${v}` })
      .setFormat({ y: (v) => `y${v}` })
      .build(fakeContainer());

    expect(plot.getOptions().axis?.x?.format?.(1)).toBe("x1");
    expect(plot.getOptions().axis?.y?.format?.(2)).toBe("y2");
  });

  it("should default to axis labels on", () => {
    const { deps } = withFakeLayers(testBrowserDeps());

    const plot = PlotBuilder.create(deps, lineSeries()).build(fakeContainer());

    expect(plot.getOptions().axis?.x?.showLabels ?? true).toBe(true);
  });
});

it("rolls back the plot and observer when initial registration fails", () => {
  const { deps, factory } = withFakeLayers(testBrowserDeps());
  let stopped = 0;
  expect(() => PlotBuilder.create({
    ...deps,
    observeSize: () => () => { stopped++; },
  }, lineSeries()).addDataPoints([{ x: 2, y: 2 }, { x: 1, y: 1 }]).build(fakeContainer())).toThrow(/sorted/);
  expect(factory.created).toHaveLength(1);
  expect(factory.created[0].destroyed).toBe(true);
  expect(stopped).toBe(1);
});
