/**
 * Collaborators are optional. Turning one off means not supplying it — the
 * four collaborators on PlotDeps used to be mandatory, so there was no
 * path at all that ran without axis labels or a divider. This is the
 * baseline that establishes: a stage that runs on a single surface.
 */
import { describe, expect, it } from "vitest";
import {
  axisLabels,
  fakeContainer,
  fakeLayersFactory,
  filledCircles,
  strokedPaths,
} from "../../__tests__/dom-fakes";
import { M4Decimation, SimpleDataManager } from "../../data";
import type { CoordinateAccessor, LineDataPoint } from "../../data";
import { createCanvasRenderer, noStyle } from "../../render";
import { LinearScale } from "../../scale";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { Plot } from "../plot";
import type { PlotDeps } from "../types";
import { defaultConfig, defaultSize } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/**
 * Hand-wired minimal setup — no preset. No axis labels, no divider, no
 * interaction. Only three collaborators are required: createLayers,
 * createRenderer, createStyleReader. These three must have no fallback,
 * or canvas and getComputedStyle would leak into the bundle of someone
 * who never opted in.
 */
function minimal() {
  const factory = fakeLayersFactory();
  const container = fakeContainer();

  const deps: PlotDeps = {
    xScale: new LinearScale(),
    mainPaneYScale: new LinearScale(),
    createDataManager: <T extends { x: number }>(
      coordinates: CoordinateAccessor<T>,
    ) =>
      new SimpleDataManager<T>({
        coordinates,
        decimation: new M4Decimation(coordinates),
      }),
    createLayers: factory.createLayers,
    createRenderer: createCanvasRenderer,
    createStyleReader: () => noStyle,
  };

  const plot = new Plot({
    deps,
    config: { ...defaultConfig, showGrid: false },
    size: defaultSize,
  });

  return { plot, deps, container, layers: factory.created[0] };
}

describe("minimal wiring", () => {
  it("should draw a series with nothing but a surface", () => {
    const { plot, layers } = minimal();

    plot.mainPane.addSeries({ series: lineSeries(), data });
    plot.render();

    const line = strokedPaths(layers.context).find(
      (path) => path.width === DEFAULT_LINE_STYLE.line.width,
    );

    expect(line?.points).toHaveLength(data.length);
    expect(filledCircles(layers.context)).toHaveLength(data.length);
  });

  it("should put no labels on the overlay", () => {
    const { plot, layers } = minimal();

    plot.mainPane.addSeries({ series: lineSeries(), data });
    plot.render();

    // Nothing exists to put labels there. Not a setting to toggle — it simply **isn't there**.
    expect(axisLabels(layers.overlay)).toHaveLength(0);
  });

  it("should still lay out several panes without dividers", () => {
    const { plot } = minimal();

    plot.mainPane.addSeries({ series: lineSeries(), data });
    const lower = plot.addPane({ flex: 1 });
    lower.addSeries({ series: lineSeries(), data });
    plot.render();

    // No handle to drag, but the height distribution still runs.
    expect(plot.panes).toHaveLength(2);
    expect(lower.area.top).toBeGreaterThanOrEqual(plot.mainPane.area.bottom);
  });

  it("should move the domain through the API without an input handler", () => {
    const { plot, deps } = minimal();

    plot.mainPane.addSeries({ series: lineSeries(), data });
    const [before] = deps.xScale.getDomain();

    plot.pan(25);

    // No input is accepted, but the stage still moves — a host can drive it directly.
    expect(deps.xScale.getDomain()[0]).toBe(before + 25);
  });

  it("should tear down cleanly", () => {
    const { plot, layers } = minimal();

    plot.mainPane.addSeries({ series: lineSeries(), data });
    plot.render();

    expect(() => plot.destroy()).not.toThrow();
    expect(layers.destroyed).toBe(true);
  });
});
