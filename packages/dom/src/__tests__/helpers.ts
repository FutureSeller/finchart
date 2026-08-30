import type {
  BaseDataPoint,
  PlotConfig,
  PlotDeps,
  Series,
  SeriesHandle,
} from "@finchart/core";
import { Plot } from "@finchart/core";
import {
  fakeContainer,
  fakeLayersFactory,
  type FakeLayers,
} from "./fakes";

export const defaultConfig: PlotConfig = {
  padding: { top: 20, right: 20, bottom: 20, left: 20 },
  showGrid: true,
};

export const defaultSize = { width: 800, height: 600 };

export interface MountOptions<T extends BaseDataPoint> {
  deps: PlotDeps;
  /** If omitted, stands up without a series — for testing the path where one is added later. */
  series?: Series<T> | null;
  config?: PlotConfig;
  /** The data that series starts out holding. */
  data?: T[];
  size?: { width: number; height: number };
}

/**
 * Stands up one stage. **Give it a series and you get a handle back.**
 *
 * Tests that swap out data use that handle, not `plot.setData` — ownership
 * of data belongs to the registration, so the stage has no such method.
 */
export function mountPlot<T extends BaseDataPoint>({
  deps,
  series = null,
  config = defaultConfig,
  data,
  size = defaultSize,
}: MountOptions<T>) {
  const factory = fakeLayersFactory();
  const container = fakeContainer();
  const plot = new Plot({
    deps: { ...deps, createLayers: factory.createLayers },
    config,
    size,
  });

  /**
   * Added here rather than passed to the constructor — the constructor path
   * doesn't hand back a handle. The moment it's added is also the first
   * data's arrival, so the refit happens right then too.
   */
  const handle = series
    ? plot.mainPane.addSeries({ series, data })
    : noHandle<T>();

  return { plot, handle, container, layers: factory.created[0] as FakeLayers };
}

/**
 * Stands in for the handle when no series was added.
 *
 * Leaving it `null` would force a hundred-odd call sites to tack on
 * `handle!`. This throws on use instead, but it does so **saying why it's
 * missing** — a value that doesn't lie to the type system.
 */
function noHandle<T extends BaseDataPoint>(): SeriesHandle<T> {
  const missing = (): never => {
    throw new Error("mountPlot was not given a series, so there is no handle");
  };

  return {
    read: missing,
    setData: missing,
    prepend: missing,
    append: missing,
    updateLast: missing,
    swapSeries: missing,
    get xRange(): never {
      return missing();
    },
    get attached(): never {
      return missing();
    },
    dispose: missing,
  };
}
