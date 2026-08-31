import { describe, expect, it } from "vitest";
import { strokedPaths } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A series that only claims a fixed extent and logs the order it was drawn in. */
function fakeSeries(
  name: string,
  extent: { min: number; max: number },
  log: string[],
): Series<LineDataPoint> {
  return {
    valueExtent: () => extent,
    draw(_renderer: CanvasRenderer, _context: SeriesContext<LineDataPoint>) {
      log.push(name);
    },
  };
}

function loaded() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: false,
    axis: { x: { showLabels: false }, y: { showLabels: false } },
  } });
  handle.setData(data);
  return { plot, handle, xScale, yScale, layers };
}

describe("mainPane", () => {
  it("should hold the series the plot was built with", () => {
    const { plot } = loaded();

    expect(plot.mainPane.getSeries()).toHaveLength(1);
  });

  it("should keep setSeries replacing everything", () => {
    const { plot } = loaded();
    const log: string[] = [];
    plot.mainPane.addSeries({ series: fakeSeries("extra", { min: 0, max: 1 }, log), data });

    plot.setSeries(lineSeries());

    expect(plot.mainPane.getSeries()).toHaveLength(1);
  });
});

describe("addSeries", () => {
  it("should draw every registered series", () => {
    const { plot } = loaded();
    const log: string[] = [];

    plot.mainPane.addSeries({ series: fakeSeries("a", { min: 0, max: 30 }, log), data });
    plot.mainPane.addSeries({ series: fakeSeries("b", { min: 0, max: 30 }, log), data });

    log.length = 0; // Exclude the render triggered by registration — check only this frame
    plot.render();

    expect(log).toEqual(["a", "b"]);
  });

  it("should draw in registration order so later series sit on top", () => {
    const { plot } = loaded();
    const log: string[] = [];

    plot.setSeries({ series: fakeSeries("base", { min: 0, max: 30 }, log), data });
    plot.mainPane.addSeries({ series: fakeSeries("overlay", { min: 0, max: 30 }, log), data });

    log.length = 0;
    plot.render();

    expect(log).toEqual(["base", "overlay"]);
  });

  it("should let zIndex sink a late registration below earlier ones", () => {
    const { plot } = loaded();
    const log: string[] = [];

    plot.setSeries({ series: fakeSeries("candles", { min: 0, max: 30 }, log), data });
    // A band fill turned on late by a toggle — registered late, but drawn underneath (dogfooding #5)
    plot.mainPane.addSeries({
      series: fakeSeries("fill", { min: 0, max: 30 }, log),
      data,
      zIndex: -1,
    });
    plot.mainPane.addSeries({ series: fakeSeries("line", { min: 0, max: 30 }, log), data });

    log.length = 0;
    plot.render();

    expect(log).toEqual(["fill", "candles", "line"]);
  });

  it("should keep drawing the original series alongside the new one", () => {
    const { plot, layers } = loaded();
    const log: string[] = [];

    plot.mainPane.addSeries({ series: fakeSeries("extra", { min: 0, max: 30 }, log), data });

    log.length = 0;
    plot.render();

    const line = strokedPaths(layers.context).find(
      (path) => path.width === DEFAULT_LINE_STYLE.line.width,
    );
    expect(line?.points.length).toBeGreaterThan(1);
    expect(log).toEqual(["extra"]);
  });

  it("should remove the series through the handle", () => {
    const { plot } = loaded();
    const log: string[] = [];

    const added = plot.mainPane.addSeries({ series: fakeSeries("temp", { min: 0, max: 30 }, log), data });
    added.dispose();

    log.length = 0;
    plot.render();

    expect(log).toEqual([]);
    expect(plot.mainPane.getSeries()).toHaveLength(1);
  });

  it("should ignore a dispose called twice", () => {
    const { plot } = loaded();
    const log: string[] = [];
    const added = plot.mainPane.addSeries({ series: fakeSeries("temp", { min: 0, max: 30 }, log), data });

    added.dispose();
    added.dispose();

    expect(plot.mainPane.getSeries()).toHaveLength(1);
  });

  it("should re-render so the caller sees the new series", () => {
    const { plot } = loaded();
    let renders = 0;
    plot.on("render", () => renders++);

    plot.mainPane.addSeries({ series: fakeSeries("a", { min: 0, max: 30 }, []), data });

    expect(renders).toBe(1);
  });
});

describe("value domain across series", () => {
  it("should span the union of every series extent", () => {
    const { plot, yScale } = loaded();
    const log: string[] = [];

    plot.setSeries({ series: fakeSeries("low", { min: 0, max: 10 }, log), data });
    plot.mainPane.addSeries({ series: fakeSeries("high", { min: 90, max: 100 }, log), data });
    plot.fitDomains();

    // 0~100 gets 10% of padding added.
    expect(yScale.getDomain()).toEqual([-10, 110]);
  });

  it("should widen when a series reaching further is added", () => {
    const { plot, yScale } = loaded();
    plot.setSeries({ series: fakeSeries("low", { min: 0, max: 10 }, []), data });
    plot.fitDomains();
    const before = yScale.getDomain();

    plot.mainPane.addSeries({ series: fakeSeries("high", { min: 0, max: 100 }, []), data });
    plot.fitDomains();

    expect(yScale.getDomain()[1]).toBeGreaterThan(before[1]);
  });

  it("should shrink back when that series is removed", () => {
    const { plot, yScale } = loaded();
    plot.setSeries({ series: fakeSeries("low", { min: 0, max: 10 }, []), data });
    const high = plot.mainPane.addSeries({ series: fakeSeries("high", { min: 0, max: 100 }, []), data });
    plot.fitDomains();

    high.dispose();
    plot.fitDomains();

    expect(yScale.getDomain()).toEqual([-1, 11]);
  });

  it("should leave the value domain alone when the pane has no series", () => {
    const { plot, yScale } = loaded();
    plot.fitDomains();
    const before = yScale.getDomain();

    plot.mainPane.clearSeries();
    plot.fitDomains();

    expect(yScale.getDomain()).toEqual(before);
  });
});
