import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { strokedPaths, testBrowserDeps } from "../../__tests__/dom-fakes";
import type { StyleReader } from "../../render";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A series that draws nothing — so the only line left on the canvas is the divider. */
function silentSeries(): Series<LineDataPoint> & {
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

function mount(vars: Record<string, string> = {}, config = {}) {
  const read: StyleReader = (name) => vars[name] ?? "";
  const deps = testBrowserDeps({ createStyleReader: () => read });
  const top = silentSeries();
  const { plot, layers } = mountPlot({
    deps,
    series: top,
    data,
    config: {
      ...defaultConfig,
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
      ...config,
    },
  });
  return { plot, layers, top };
}

describe("pane divider line", () => {
  it("should draw one line on the boundary between two panes", () => {
    const { plot, layers, top } = mount();
    const bottom = silentSeries();
    plot.addPane().addSeries({ series: bottom, data });
    plot.render();

    const paths = strokedPaths(layers.context);
    expect(paths).toHaveLength(1);

    const [line] = paths;
    const upper = top.seen.at(-1)!.area;
    const lower = bottom.seen.at(-1)!.area;
    expect(line.points).toHaveLength(2);
    expect(line.points[0].y).toBe(line.points[1].y);
    expect(line.points[0].y).toBeGreaterThanOrEqual(upper.bottom);
    expect(line.points[0].y).toBeLessThanOrEqual(lower.top);
    expect(line.points[0].x).toBe(upper.left);
    expect(line.points[1].x).toBe(upper.right);
  });

  it("should draw nothing with a single pane", () => {
    const { plot, layers } = mount();
    plot.render();

    expect(strokedPaths(layers.context)).toHaveLength(0);
  });

  it("should read the --chart-pane-divider variables", () => {
    const { plot, layers } = mount({
      "--chart-pane-divider": "#123456",
      "--chart-pane-divider-width": "2",
    });
    plot.addPane().addSeries({ series: silentSeries(), data });
    plot.render();

    const [line] = strokedPaths(layers.context);
    expect(line.color).toBe("#123456");
    expect(line.width).toBe(2);
  });

  it("should keep the line when panes are not resizable", () => {
    // Whether the boundary is drawn and whether it's draggable are separate facts — only the handle (DOM) is missing.
    const { plot, layers } = mount({}, { resizablePanes: false });
    plot.addPane().addSeries({ series: silentSeries(), data });
    plot.render();

    expect(strokedPaths(layers.context)).toHaveLength(1);
  });
});
