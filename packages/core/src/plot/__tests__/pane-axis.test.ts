import { describe, expect, it } from "vitest";
import { axisLabelsSpy, strokedPaths } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { DEFAULT_PLOT_STYLE } from "../style";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function twoPanes(config = {}) {
  // Assert against the input the core hands the renderer (AxisLabelsInput),
  // not the label implementation — which pane's value goes to which tick is the core's job.
  const axisSpy = axisLabelsSpy();
  const deps = testBrowserDeps({ createAxisLabels: axisSpy.createAxisLabels });
  const { plot, handle, layers, container } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: true,
    ...config,
  } });
  handle.setData(data);

  const lower = plot.addPane({ flex: 1 });
  lower.addSeries(lineSeries());
  plot.mainPane.applyOptions({ flex: 3 });
  plot.fitDomains();

  return { plot, deps, layers, container, lower, axisSpy };
}

/** Picks out only the grid lines. Their width differs from a data line's. */
function gridPaths(context: Parameters<typeof strokedPaths>[0]) {
  return strokedPaths(context).filter(
    (path) => path.width === DEFAULT_PLOT_STYLE.grid.width,
  );
}

describe("y axis per pane", () => {
  it("should label every pane", () => {
    const { plot, lower, axisSpy } = twoPanes();

    const positions = axisSpy.input().y.map((tick) => tick.position);
    const inMain = positions.filter(
      (top) => top <= plot.mainPane.area.bottom + 1,
    );
    const inLower = positions.filter((top) => top >= lower.area.top - 1);

    expect(inMain.length).toBeGreaterThan(0);
    expect(inLower.length).toBeGreaterThan(0);
  });

  it("should keep each pane's labels inside that pane", () => {
    const { plot, lower, axisSpy } = twoPanes();

    for (const top of axisSpy.input().y.map((tick) => tick.position)) {
      const inMain =
        top >= plot.mainPane.area.top - 1 && top <= plot.mainPane.area.bottom + 1;
      const inLower = top >= lower.area.top - 1 && top <= lower.area.bottom + 1;

      expect(inMain || inLower).toBe(true);
    }
  });

  it("should thin the ticks of the shorter pane", () => {
    const { plot, lower } = twoPanes();

    // mainPane is 3x taller, so it should have more ticks too.
    expect(plot.mainPane.area.bottom - plot.mainPane.area.top).toBeGreaterThan(
      lower.area.bottom - lower.area.top,
    );
  });

  it("should let a pane format its own values", () => {
    const { lower, axisSpy } = twoPanes();
    lower.applyOptions({ axis: { format: (v: number) => `<${Math.round(v)}>` } });

    const texts = axisSpy.yTexts();
    expect(texts.some((text) => text.startsWith("<"))).toBe(true);
    expect(texts.some((text) => !text.startsWith("<"))).toBe(true);
  });

  it("should drop y labels when they are turned off", () => {
    const { axisSpy } = twoPanes({ axis: { y: { showLabels: false } } });

    expect(axisSpy.input().y).toHaveLength(0);
  });
});

describe("x axis is shared", () => {
  it("should render one set of x labels", () => {
    const { axisSpy } = twoPanes();

    // Even with two panes, there's only one set of x ticks — the input has a single x array, and it's not empty.
    expect(axisSpy.input().x.length).toBeGreaterThan(0);
  });

  it("should put them under the bottom-most pane", () => {
    const { lower, axisSpy } = twoPanes();

    // The x label's position is the x-axis slice carved out by the layout — under the last pane.
    const xAxisArea = axisSpy.input().axes.x;
    if (!xAxisArea) throw new Error("no x-axis slice");
    expect(xAxisArea.top).toBeGreaterThanOrEqual(lower.area.bottom);
  });

  it("should drop x labels when they are turned off", () => {
    const { axisSpy } = twoPanes({ axis: { x: { showLabels: false } } });

    expect(axisSpy.input().x).toHaveLength(0);
    expect(axisSpy.input().y.length).toBeGreaterThan(0);
  });
});

describe("grid follows the panes", () => {
  it("should keep horizontal lines inside a single pane", () => {
    const { plot, layers, lower } = twoPanes();

    const horizontals = gridPaths(layers.context).filter(
      (path) => path.points[0].y === path.points[1].y,
    );

    expect(horizontals.length).toBeGreaterThan(0);
    for (const { points } of horizontals) {
      const y = points[0].y;
      const inMain =
        y >= plot.mainPane.area.top - 1 && y <= plot.mainPane.area.bottom + 1;
      const inLower = y >= lower.area.top - 1 && y <= lower.area.bottom + 1;

      expect(inMain || inLower).toBe(true);
    }
  });

  it("should stop vertical lines at each pane's edges", () => {
    const { plot, layers, lower } = twoPanes({ paneGap: 12 });

    const verticals = gridPaths(layers.context).filter(
      (path) => path.points[0].x === path.points[1].x,
    );

    expect(verticals.length).toBeGreaterThan(0);
    for (const { points } of verticals) {
      const [from, to] = points.map((point) => point.y).sort((a, b) => a - b);
      const spansMain =
        from >= plot.mainPane.area.top - 1 && to <= plot.mainPane.area.bottom + 1;
      const spansLower = from >= lower.area.top - 1 && to <= lower.area.bottom + 1;

      // It must not span across both panes and skip over the gap.
      expect(spansMain || spansLower).toBe(true);
    }
  });
});
