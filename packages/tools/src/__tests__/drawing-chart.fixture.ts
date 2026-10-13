import {
  createPlotModel,
  lineSeries,
  type BaseDataPoint,
  type LineDataPoint,
  type Observable,
  type Point,
  type SeriesRegistration,
} from "@finchart/core";
import { onTestFinished } from "vitest";
import { drawingTools, type DrawingToolsOptions } from "../tools";

/** Where a gesture lands: a domain anchor, or a pixel when the pixel itself is the point. */
export type Spot = { x: number; price: number } | { px: number; py: number };

const lineData: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

interface DrawingChartOptions<T extends BaseDataPoint> {
  /** Defaults to a line through {@link lineData}. */
  series?: SeriesRegistration<T>;
  tools?: Omit<DrawingToolsOptions, "plot">;
}

/**
 * An 800x600 headless chart with drawing tools on its main pane, grid and
 * tick labels off, rendered once and destroyed when the test finishes.
 *
 * Gestures only send input; they never assert. They return whether the
 * chart consumed the input, so a test can check that itself: `press` through
 * its `down`, `moveTo` and `release`, and `click` and `drag` with the press's
 * answer.
 */
export function drawingChart<T extends BaseDataPoint = LineDataPoint>(
  options: DrawingChartOptions<T> = {},
) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const { plot } = model;
  onTestFinished(() => plot.destroy());
  const pane = plot.mainPane;
  if (options.series) pane.addSeries(options.series);
  else pane.addSeries({ series: lineSeries(), data: lineData });
  const tools = pane.use(drawingTools({ ...options.tools, plot }));
  plot.render();

  const at = (x: number, price: number): Point => ({
    x: plot.pixelAtX(x),
    y: pane.yScale.scale(price),
  });
  const pixel = (spot: Spot): Point =>
    "price" in spot ? at(spot.x, spot.price) : { x: spot.px, y: spot.py };
  /** Mid-pane at `price`, `dy` pixels lower: where a test aims at a horizontal line. */
  const onLine = (price: number, dy = 0) => ({
    px: (pane.area.left + pane.area.right) / 2,
    py: pane.yScale.scale(price) + dy,
  });
  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", spot: Spot) =>
    plot.routeInput({ type, point: pixel(spot), pointerId: 1 });

  /** A press held down, for tests that look mid-gesture. */
  const press = (spot: Spot) => {
    const down = pointer("pointerdown", spot);
    let last = spot;
    return {
      down,
      moveTo(next: Spot) {
        last = next;
        return pointer("pointermove", next);
      },
      release() {
        return pointer("pointerup", last);
      },
    };
  };

  const click = (spot: Spot) => {
    const down = pointer("pointerdown", spot);
    pointer("pointerup", spot);
    return down;
  };

  const drag = (from: Spot, to: Spot) => {
    const gesture = press(from);
    gesture.moveTo(to);
    gesture.release();
    return gesture.down;
  };

  return {
    model,
    plot,
    pane,
    tools,
    route: plot.routeInput.bind(plot),
    at,
    onLine,
    hover: (spot: Spot) => pointer("pointermove", spot),
    press,
    click,
    drag,
    dblclick: (spot: Spot) => plot.routeInput({ type: "dblclick", point: pixel(spot) }),
    key: (key: string) => plot.routeInput({ type: "keydown", key }),
  };
}

/** Collects every value `source` emits from now on. */
export function record<T>(source: Observable<T>): T[] {
  const seen: T[] = [];
  source.subscribe((value) => seen.push(value));
  return seen;
}
