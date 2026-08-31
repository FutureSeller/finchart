import {
  fakeContainer,
  fakeLayersFactory,
  type FakeLayers,
} from "../../__tests__/dom-fakes";
import type { BaseDataPoint } from "../../data";
import type { Series } from "../../series";
import type { SeriesHandle } from "../series-handle";
import { Plot } from "../plot";
import type { PlotConfig, PlotDeps } from "../types";

// Required-but-widened: tests read `defaultConfig.padding.left` and flip
// `showGrid`, and the loose config contract alone can't promise either.
export const defaultConfig: PlotConfig &
  Required<Pick<PlotConfig, "padding" | "showGrid">> = {
  padding: { top: 20, right: 20, bottom: 20, left: 20 },
  showGrid: true,
};

export const defaultSize = { width: 800, height: 600 };

export interface MountOptions<T extends BaseDataPoint> {
  deps: PlotDeps;
  /** Omit to mount with no series — for testing the path where one is added later. */
  series?: Series<T> | null;
  config?: PlotConfig;
  /** The data that series starts out with. */
  data?: T[];
  size?: { width: number; height: number };
}

/** Mounts a single stage — giving it a series returns a handle along with it. Tests that swap out data use that handle. */
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

  /** Attached here rather than passed to the constructor — the moment of
   * attachment is the first data's arrival, so that's when the refit happens too. */
  const handle = series
    ? plot.mainPane.addSeries({ series, data })
    : noHandle<T>();

  return { plot, handle, container, layers: factory.created[0] as FakeLayers };
}

/** A stand-in handle for when no series was attached — instead of null, a
 * value that blows up on use while saying why it's missing. */
function noHandle<T extends BaseDataPoint>(): SeriesHandle<T> {
  const missing = (): never => {
    throw new Error("no handle: mountPlot was not given a series");
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
