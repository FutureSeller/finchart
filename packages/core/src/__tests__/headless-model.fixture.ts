import { onTestFinished } from "vitest";
import type { BaseDataPoint } from "../data";
import { createPlotModel, type PlotModelOptions } from "../plot/model";

/**
 * A headless chart, 800x600 unless `size` says otherwise, with the grid and
 * tick labels off so the commands hold only what a test draws. A `config`
 * replaces those defaults key by key, and the plot is destroyed when the
 * test finishes.
 */
export function headlessModel<T extends BaseDataPoint = BaseDataPoint>(
  options: Partial<PlotModelOptions<T>> = {},
) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    ...options,
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
      ...options.config,
    },
  });
  onTestFinished(() => model.plot.destroy());
  return model;
}
