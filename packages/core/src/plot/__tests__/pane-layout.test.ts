import { describe, expect, it } from "vitest";
import type { PlotArea } from "../../primitives";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** Captures the stage information it received when drawing, as-is. */
function spySeries(): Series<LineDataPoint> & { seen: SeriesContext<LineDataPoint>[] } {
  const seen: SeriesContext<LineDataPoint>[] = [];

  return {
    seen,
    valueExtent: () => ({ min: 0, max: 100 }),
    draw(_renderer: CanvasRenderer, context: SeriesContext<LineDataPoint>) {
      seen.push(context);
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

const heightOf = (area: PlotArea) => area.bottom - area.top;

describe("addPane", () => {
  it("should give the new pane its own value scale", () => {
    const { plot, yScale } = loaded();

    const pane = plot.addPane();

    expect(pane.yScale).not.toBe(yScale);
    expect(plot.mainPane.yScale).toBe(yScale);
  });

  it("should stack the panes without overlapping", () => {
    const { plot } = loaded();
    const top = spySeries();
    const bottom = spySeries();

    plot.setSeries({ series: top, data });
    plot.addPane().addSeries({ series: bottom, data });
    plot.render();

    const upper = top.seen.at(-1)!.area;
    const lower = bottom.seen.at(-1)!.area;
    expect(lower.top).toBeGreaterThanOrEqual(upper.bottom);
  });

  it("should divide the height by flex", () => {
    const { plot } = loaded();
    const top = spySeries();
    const bottom = spySeries();

    plot.setSeries({ series: top, data });
    plot.addPane({ flex: 1 }).addSeries({ series: bottom, data });
    plot.mainPane.applyOptions({ flex: 3 });
    plot.render();

    const upper = heightOf(top.seen.at(-1)!.area);
    const lower = heightOf(bottom.seen.at(-1)!.area);
    expect(upper / lower).toBeCloseTo(3, 1);
  });

  it("should honour minHeight over the flex ratio", () => {
    const { plot } = loaded();
    const top = spySeries();
    const bottom = spySeries();

    plot.setSeries({ series: top, data });
    plot.addPane({ flex: 1, minHeight: 200 }).addSeries({ series: bottom, data });
    plot.mainPane.applyOptions({ flex: 50 });
    plot.render();

    expect(heightOf(bottom.seen.at(-1)!.area)).toBeGreaterThanOrEqual(200);
  });

  it("should keep every pane inside the plot area", () => {
    const { plot } = loaded();
    const top = spySeries();
    const bottom = spySeries();

    plot.setSeries({ series: top, data });
    plot.addPane().addSeries({ series: bottom, data });
    plot.render();

    const { padding } = defaultConfig;
    expect(top.seen.at(-1)!.area.top).toBeGreaterThanOrEqual(padding.top);
    expect(bottom.seen.at(-1)!.area.bottom).toBeLessThanOrEqual(
      defaultSize.height - padding.bottom,
    );
  });

  it("should map the pane's value scale onto its own slice", () => {
    const { plot } = loaded();
    const series = spySeries();
    const pane = plot.addPane();
    pane.addSeries({ series, data });
    plot.fitDomains();

    const area = series.seen.at(-1)!.area;
    // Screen y increases downward, so the range is flipped to [bottom, top].
    expect(pane.yScale.getRange()).toEqual([area.bottom, area.top]);
  });

  it("should re-render when a pane is added", () => {
    const { plot } = loaded();
    let renders = 0;
    plot.on("render", () => renders++);

    plot.addPane();

    expect(renders).toBe(1);
  });
});

describe("removePane", () => {
  it("should give the space back to the remaining panes", () => {
    const { plot } = loaded();
    const top = spySeries();
    plot.setSeries({ series: top, data });
    const pane = plot.addPane();
    plot.render();
    const shared = heightOf(top.seen.at(-1)!.area);

    plot.removePane(pane);
    plot.render();

    expect(heightOf(top.seen.at(-1)!.area)).toBeGreaterThan(shared);
  });

  it("should stop drawing the removed pane's series", () => {
    const { plot } = loaded();
    const gone = spySeries();
    const pane = plot.addPane();
    pane.addSeries({ series: gone, data });

    plot.removePane(pane);
    gone.seen.length = 0;
    plot.render();

    expect(gone.seen).toHaveLength(0);
  });

  it("should ignore a pane that was already removed", () => {
    const { plot } = loaded();
    const pane = plot.addPane();
    plot.removePane(pane);

    expect(() => plot.removePane(pane)).not.toThrow();
  });
});

describe("single pane", () => {
  it("should still fill the whole plot area", () => {
    const { plot } = loaded();
    const series = spySeries();

    plot.setSeries({ series, data });
    plot.render();

    const { padding } = defaultConfig;
    expect(series.seen.at(-1)!.area).toEqual({
      left: padding.left,
      right: defaultSize.width - padding.right,
      top: padding.top,
      bottom: defaultSize.height - padding.bottom,
    });
  });
});
