import { applyColor } from "./canvas-renderer";
import {
  ContractError,
  describe,
  requireDataArray,
  requireObject,
  type Point,
} from "../primitives";
import type { Canvas2DContext, DrawTarget } from "./types";
import { drawCustom } from "./types";

/**
 * A linear-gradient fill — the first first-class primitive to travel
 * through the `custom` door.
 *
 * Why `ShapeParams.fill` isn't widened to `string | gradient`: every replay
 * surface that reads `fill` and assigns it to `fillStyle` would break at
 * once. Sending it through the custom door means a surface that knows it
 * (the core canvas renderer knows it by default) draws the gradient, and a
 * surface that doesn't demotes to the fallback's flat color — the picture
 * doesn't get a hole in it.
 */
export const LINEAR_GRADIENT = "charts/linear-gradient";

export interface GradientStop {
  /** Position between 0 (from) and 1 (to). */
  readonly offset: number;
  readonly color: string;
}

/** Plain data — no functions or brush objects, so it passes straight through a worker or serialization path. */
export interface LinearGradientParams {
  /** The polygon to fill (screen coordinates). */
  readonly points: readonly Point[];
  /** Start of the gradient axis — where offset 0 sits. */
  readonly from: Point;
  /** End of the gradient axis — where offset 1 sits. */
  readonly to: Point;
  readonly stops: readonly GradientStop[];
}

/**
 * Sends out a request to fill a polygon with a gradient.
 *
 * Passing through this function automatically loads a fallback — **the
 * first stop's flat color**. Demoting to "a flat fill in the top color" on
 * a surface that doesn't know gradients beats not drawing at all, and the
 * fallback is only trustworthy if you can predict which color it'll be.
 */
export function fillLinearGradient(
  target: DrawTarget,
  params: LinearGradientParams,
): void {
  // `area-series.ts` calls this function, and params is a consumer value
  // that arrived via `areaSeries({ fill })` — being a render-internal
  // utility doesn't excuse skipping validation.
  requireObject(target, "fillLinearGradient(target)");
  requireObject(params, "fillLinearGradient(params)");
  requireDataArray(params.points, "fillLinearGradient params.points");
  requireDataArray(params.stops, "fillLinearGradient params.stops");
  drawCustom(target, {
    name: LINEAR_GRADIENT,
    params,
    fallback: [
      {
        type: "drawShape",
        shape: {
          shape: "polygon",
          points: [...params.points],
          fill: params.stops[0]?.color ?? "transparent",
        },
      },
    ],
  });
}

/**
 * The painter the core canvas renderer loads by default — it's only right
 * that a primitive sent through its own door is known to its own renderer.
 * A third-party renderer that loads this same function into its painters
 * will draw the same name too.
 */
export function paintLinearGradient(
  context: Canvas2DContext,
  params: unknown,
): void {
  if (!isLinearGradientParams(params)) {
    // A bug on the side that sent a different shape under the same name —
    // it doesn't get to quietly leave an empty picture behind.
    // Goes through describe — JSON.stringify(params) throws on a circular
    // reference, and the message runs past tens of thousands of characters
    // on a large polygon.
    throw new ContractError(
      `${LINEAR_GRADIENT} params don't match the contract: ${describe(params)}`,
    );
  }

  const { points, from, to, stops } = params;
  if (points.length < 3) return;

  // A bad value is a demotion, not an exception. Assigning to fillStyle
  // quietly ignores a bad color, but addColorStop throws a DOMException —
  // this absorbs that asymmetry here, so a single typo in a style variable
  // can't kill the render loop. The demotion is the same first-stop flat
  // color as the fallback, so the evidence stays visible on screen.
  let brush: string | ReturnType<Canvas2DContext["createLinearGradient"]>;
  try {
    const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
    for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
    brush = gradient;
  } catch {
    brush = stops[0]?.color ?? "transparent";
  }

  // The demotion goes through the same door too — the fallback here is
  // stops[0].color, and the most common reason addColorStop throws is
  // exactly that stop's color being invalid, so skipping the demotion
  // would leave a no-op assignment and the previous command's fill
  // untouched.
  applyColor(context, "fillStyle", brush);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.closePath();
  context.fill();
}

/** The idiom a replay surface uses to narrow `unknown` params — the painter uses it too. */
export function isLinearGradientParams(
  value: unknown,
): value is LinearGradientParams {
  return (
    typeof value === "object" &&
    value !== null &&
    "points" in value &&
    Array.isArray(value.points) &&
    value.points.every(isPoint) &&
    "from" in value &&
    isPoint(value.from) &&
    "to" in value &&
    isPoint(value.to) &&
    "stops" in value &&
    Array.isArray(value.stops) &&
    value.stops.every(isStop)
  );
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    typeof value.x === "number" &&
    "y" in value &&
    typeof value.y === "number"
  );
}

function isStop(value: unknown): value is GradientStop {
  return (
    typeof value === "object" &&
    value !== null &&
    "offset" in value &&
    typeof value.offset === "number" &&
    "color" in value &&
    typeof value.color === "string"
  );
}
