/**
 * The sparkline recipe compiles here. The prose it came from lives in the
 * private development repository, so nothing in this repo can compare the two.
 *
 * A doc's example is just a string, so it goes stale silently as the API
 * grows — the sparkline recipe is even more exposed to this, since it's the
 * only doc path that doesn't use a preset: it writes out by hand the slots
 * `browserDeps` normally fills in, so a single change is enough to make the
 * doc a lie.
 *
 * (Since the file isn't `.test.ts`, vitest ignores it and only `tsc` looks
 * at it.)
 */

import type { LineDataPoint } from "@finchart/core";
import {
  createCanvasRenderer,
  createPlotDeps,
  lineSeries,
  noStyle,
  Plot,
} from "@finchart/core";
import { createDomLayers } from "../dom-layers";
import { observeDevicePixelRatio } from "../observe-resolution";

declare const row: HTMLElement;
declare const closes: LineDataPoint[];

/**
 * A sparkline for one row of a ticker list.
 *
 * **Three things are required** — where (`createLayers`), what with
 * (`createRenderer`), and in what style (`createStyleReader`). The rest (x/y
 * scales, the data manager) get filled in by `createPlotDeps` with defaults
 * that know nothing about the browser.
 *
 * Whatever isn't supplied simply doesn't exist: axis labels, dividers,
 * pointer input, and the frame scheduler are all missing, so none of them
 * make it into the bundle either.
 */
export const sparklineDeps = createPlotDeps({
  createLayers: (width, height) => createDomLayers(row, width, height),
  createRenderer: createCanvasRenderer,
  /** Doesn't read CSS variables — avoids creating one `getComputedStyle` per row. */
  createStyleReader: () => noStyle,
  /**
   * This is the one observer a sparkline actually needs. `browserDeps`
   * fills this slot by default, but `createPlotDeps` doesn't — without it,
   * the sparkline goes blurry after the monitor changes.
   */
  observeResolution: observeDevicePixelRatio(row),
});

export const sparkline = new Plot({
  deps: sparklineDeps,
  config: {
    // The grid defaults to on — at a 120px width, its lines would cover the drawing.
    showGrid: false,
    // No axes means no margin either — just enough that the line's width doesn't get clipped.
    // (`DEFAULT_PADDING` is sized for a stage with axis labels, which is too much here.)
    padding: { top: 2, right: 2, bottom: 2, left: 2 },
  },
  size: { width: 120, height: 32 },
});

sparkline.mainPane.addSeries({
  // The point radius defaults to 3 — with 30 points across 120px, the circles would overlap and thicken the line.
  series: lineSeries({ point: { radius: 0 }, line: { width: 1.5 } }),
  data: closes,
});

/** Draws immediately since no scheduler was supplied — there's no frame to wait for. */
sparkline.render();
