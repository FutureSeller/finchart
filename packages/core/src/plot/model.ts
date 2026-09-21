import { requireObject } from "../primitives";
import { createCanvasAxisLabels } from "../axis";
import type { BaseDataPoint } from "../data";
import type { DrawCommand } from "../render";
import { createMemoryLayers, noStyle, recordingRenderer } from "../render";
import type { Series } from "../series";
import type { SeriesRegistration } from "../registration";
import { Plot } from "./plot";
import type { ViewportDimensions } from "./config";
import { createPlotDeps, type PlotDepsOptions } from "./presets";
import type { PlotConfig } from "./types";

/**
 * What headless wiring lets you choose — anything that attaches to the DOM
 * is left out.
 *
 * `createLayers` and `createRenderer` are the model's identity, so they
 * can't be overridden: the layers must be in-memory and the renderer must
 * be a recording one, or `commands()` wouldn't make sense. Input, dividers,
 * and size observation have no DOM to attach to.
 */
export type PlotModelDepsOptions = Omit<
  PlotDepsOptions,
  | "createLayers"
  | "createRenderer"
  | "interactions"
  | "createDividers"
  | "observeSize"
>;

export interface PlotModelOptions<T extends BaseDataPoint = BaseDataPoint> {
  size: ViewportDimensions;
  /** One series + data registration. To add more later, use `model.plot.mainPane.addSeries`. */
  series?: SeriesRegistration<T> | Series<T> | null;
  /** Overrides the default only for the fields given here. */
  config?: PlotConfig;
  /** Swaps in a different scale, mapping, data policy, text measurer, labels, or style resolution. */
  deps?: PlotModelDepsOptions;
}

export interface PlotModel {
  /** The chart itself — state, data, decoration, and plugin APIs, all intact. */
  plot: Plot;
  /**
   * The draw commands from the last frame. **This is the model's output** —
   * it includes grid, series, and decorations, down to tick labels and
   * badges. It's plain data, so serializing it, sending it to a worker, and
   * asserting on it as a snapshot are all safe.
   */
  commands(): readonly DrawCommand[];
}

/**
 * A chart with neither a DOM nor a canvas.
 *
 * The entry point for server rendering, workers, tests, and other surfaces.
 * It builds **the same `Plot`** as the browser entry point (`browserDeps` +
 * `PlotBuilder`) — the model isn't a separate class, just different wiring,
 * so there's nothing to maintain twice.
 *
 * ```ts
 * // Turn off showGrid — otherwise the grid is drawLine too, so the first line would be a grid line.
 * const model = createPlotModel({
 *   size,
 *   series: { series: lineSeries(), data },
 *   config: { showGrid: false },
 * });
 * const [line] = model.commands().filter((c) => c.type === "drawLine");
 * ```
 *
 * Default wiring: in-memory layers, a recording renderer, an empty
 * `StyleReader` (colors fall back to code defaults — for theming, use
 * `config.style` or `deps.createStyleReader`), and canvas tick labels
 * (disable with `config.axis.showLabels`). No text measurer by default —
 * axis width falls back to a fixed value, and an environment that knows font
 * metrics supplies one via `deps.createTextMeasurer`.
 */
export function createPlotModel<T extends BaseDataPoint = BaseDataPoint>(
  options: PlotModelOptions<T>,
): PlotModel {
  requireObject(options, "createPlotModel(options)");
  const recorder = recordingRenderer();

  const deps = createPlotDeps({
    ...options.deps,
    createAxisLabels: options.deps?.createAxisLabels ?? createCanvasAxisLabels,
    createStyleReader: options.deps?.createStyleReader ?? (() => noStyle),
    createLayers: createMemoryLayers,
    createRenderer: recorder.factory,
  });

  const plot = new Plot({
    deps,
    // Defaults are the core door's job (`resolveConfig`) — this hands the
    // config through untouched, the explicit-undefined rule included.
    config: options.config,
    size: options.size,
  });

  // Added here instead of in the constructor — a constructor can't be
  // generic, so it would lose the pane's type, whereas `addSeries` is a
  // generic method that carries the registration's type through untouched.
  try {
    if (options.series) plot.mainPane.addSeries(options.series);
  } catch (error) {
    try { plot.destroy(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "creating PlotModel failed"); }
    throw error;
  }

  return { plot, commands: recorder.commands };
}
