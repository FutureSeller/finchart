/**
 * One more drawing primitive, with no change to the core — the custom command
 * demonstrated.
 *
 * A gradient was the case `fill: string` couldn't express: covering the
 * after-hours stretch with a band that fades from top to bottom. Widening the
 * command union for this one shape would break every consumer that switches
 * over it exhaustively.
 *
 * So three things get wired instead.
 *
 * 1. Emit the command — the decoration calls
 *    drawCustom(target, { name, params, fallback })
 * 2. Build a renderer that knows how to paint it —
 *    createCanvasRenderer(surface, { painters })
 * 3. A surface that doesn't know it paints the fallback — the headless model
 *    and server rendering take that path
 *
 * Zero lines change in the core. That is the point of this file.
 */

import { applyColor, type CanvasBrush } from "@finchart/core";
import { createCanvasRenderer, drawCustom, type CustomPainter, type FallbackCommand, type PlotDecoration, type Renderer, type RendererFactory } from "@finchart/core";

/** Namespaced — with no global registry, the name is the only thing preventing a collision. */
const GRADIENT_BAND = "examples/gradient-band";

interface GradientBandParams {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Top to bottom. This is exactly the part a single `fill: string` can't say. */
  from: string;
  to: string;
}

/** How the canvas paints this name. The wiring loads it into the renderer. */
const paintGradientBand: CustomPainter = (context, params) => {
  const { left, right, top, bottom, from, to } = params as GradientBandParams;

  // A painter receives the real 2D context — to use anything outside what
  // `Canvas2DContext` narrows to, you widen it here. The core takes no part in
  // this cast.
  const full = context as CanvasRenderingContext2D;

  /**
   * A consumer's colors reach this far — `from` and `to` arrive through
   * SessionShadingOptions, and `addColorStop` throws a DOMException on an
   * invalid color (the exact opposite of assigning to `fillStyle`, which is
   * silently ignored). There is no try/catch on the render() path, so that
   * frame would die and the error would leak out past rAF.
   *
   * The demotion is the flat first color, the same as the fallback, so the
   * evidence stays on screen. That demotion goes through applyColor too —
   * without it, an invalid color becomes the neighbor's color.
   */
  let brush: CanvasBrush;
  try {
    const gradient = full.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    brush = gradient;
  } catch {
    brush = from;
  }

  applyColor(full, "fillStyle", brush);
  full.fillRect(left, top, right - left, bottom - top);
};

/** A renderer that knows this painter. Goes straight into `browserDeps({ createRenderer })`. */
export const shadingRenderer: RendererFactory = (surface): Renderer =>
  createCanvasRenderer(surface, { painters: { [GRADIENT_BAND]: paintGradientBand } });

export interface SessionShadingOptions {
  /** From this hour of the day (UTC). */
  fromHour: number;
  /** Up to this hour. */
  toHour: number;
  from?: string;
  to?: string;
}

/**
 * A decoration that covers the after-hours stretch with a band.
 *
 * A decoration, not a plugin — it is one drawing description with no wiring.
 * Mount it with plot.addDecoration.
 */
export function sessionShading(
  options: SessionShadingOptions,
): PlotDecoration {
  const from = options.from ?? "rgba(148, 163, 184, 0.28)";
  const to = options.to ?? "rgba(148, 163, 184, 0)";

  return {
    draw(target, { area, x, ticks }) {
      /**
       * The ticks arrive already computed — compute your own and they drift
       * away from the labels.
       *
       * `Tick.value` is a domain value, not the data's x: under bar-index
       * coordinates it is a bar index, so passing it straight to `new Date()`
       * lands you in 1970. Recover the time with `fromDomain`, and use the
       * `position` the axis has already filled in for the pixel.
       */
      const spacing = bandWidth(ticks.x);

      for (const tick of ticks.x) {
        const hour = new Date(x.fromDomain(tick.value)).getUTCHours();
        if (hour < options.fromHour || hour >= options.toHour) continue;

        const left = tick.position;
        const right = Math.min(left + spacing, area.right);
        if (right <= area.left || left >= area.right) continue;

        const box = {
          left: Math.max(left, area.left),
          right,
          top: area.top,
          bottom: area.bottom,
        };

        /**
         * Ship a fallback with it — on a surface that doesn't know this name
         * (the headless model, server rendering, a different canvas wiring) a
         * flat color is drawn instead of the gradient. Less pretty, but no
         * hole.
         */
        const flat: FallbackCommand[] = [
          {
            type: "drawShape",
            shape: {
              shape: "rect",
              x: box.left,
              y: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
              fill: from,
            },
          },
        ];

        drawCustom(target, {
          name: GRADIENT_BAND,
          params: { ...box, from, to } satisfies GradientBandParams,
          fallback: flat,
        });
      }
    },
  };
}

/** How wide one tick covers. The axis has already filled the pixel into `position`. */
function bandWidth(ticks: readonly { position: number }[]): number {
  if (ticks.length < 2) return 0;
  return Math.abs(ticks[1].position - ticks[0].position);
}
