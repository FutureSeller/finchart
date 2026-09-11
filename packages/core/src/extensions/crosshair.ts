import type { AxisBadge } from "../axis";
import { contains, ContractError, type Point } from "../primitives";
import type { LineStyle, StyleSpec } from "../render";
import { resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import type { XMapping } from "../scale";
import type { PaneApi } from "../plot/pane";
import type { PlotDecoration } from "../plot/decoration";
import type { DecorationOptions } from "../plot/decoration";
import type {
  DecorationHost,
  PlotEventSource,
  RenderRequester,
} from "../plot/capabilities";
import {
  pluginApi,
  type ConfigurablePluginApi,
  type Plugin,
} from "../primitives";

export interface CrosshairLineOptions {
  /** The vertical line. Defaults to true. */
  vertical?: boolean;
  /** The horizontal line. Defaults to true. */
  horizontal?: boolean;
  /** Overrides on top of the CSS variables and defaults. */
  style?: Partial<LineStyle>;
  /**
   * Shows the cursor's value as a box on the axis. Defaults to true — an
   * axis with its line off gets no badge either. On an axis with no mounted
   * labels there's nowhere to put it, so it's dropped either way.
   */
  badges?: boolean;
  /**
   * Snaps the vertical line and x badge to the actual x of the bar beneath
   * the cursor. Defaults to false. When the cursor sits in the empty space
   * between bars, this makes the crosshair point at where data actually is
   * instead of an interpolated spot — the decision goes by the first
   * registration (`Pane.probe`) on whichever pane the cursor is over.
   */
  magnet?: boolean;
  /**
   * Badge label format. Give it the same format as the axis ticks and the
   * badge speaks the ticks' language. Defaults to a rounded integer for x,
   * two decimals for y.
   */
  format?: {
    x?: (x: number) => string;
    y?: (value: number) => string;
  };
}

/** The CSS variables the crosshair owns. */
export const CROSSHAIR_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  width: { css: "--chart-crosshair-width", fallback: 1 },
  color: { css: "--chart-crosshair", fallback: "#94a3b8" },
  dashArray: { css: "--chart-crosshair-dash", fallback: "3,3" },
}) satisfies StyleSpec<LineStyle>;

/** Default badge colors. Darker than the crosshair itself, since covering things is its job. */
export const CROSSHAIR_BADGE_SPEC = /* @__PURE__ */ styleSpec({
  back: { css: "--chart-crosshair-badge-back", fallback: "#334155" },
  color: { css: "--chart-crosshair-badge", fallback: "#f8fafc" },
}) satisfies StyleSpec<{ back: string; color: string }>;

/**
 * A crosshair that follows the cursor. It holds its own state — the cursor
 * position comes from input, not render, so it doesn't arrive via context.
 * Something outside has to feed it via `follow()` and tell `Plot` to redraw.
 * If you don't want to wire that up yourself every time, use the
 * `crosshair()` plugin.
 */
export interface CrosshairLine extends PlotDecoration {
  /** Feeds it the cursor position. `null` when it's left the margin. */
  follow(position: Point | null): void;
  /** Changes only the given fields — doesn't rebuild. See `ConfigurablePluginApi`. */
  applyOptions(patch: Partial<CrosshairLineOptions>): void;
}

export function crosshairLine(
  options: CrosshairLineOptions = {},
): CrosshairLine {
  /**
   * The options stay held together instead of being unpacked into
   * separate constants — if they were unpacked, `applyOptions` would have
   * to update six scattered spots, and missing one would go unnoticed.
   */
  let current: CrosshairLineOptions = { ...options };

  const showVertical = () => current.vertical ?? true;
  const showHorizontal = () => current.horizontal ?? true;
  const showBadges = () => current.badges ?? true;
  const magnetOn = () => current.magnet ?? false;
  let at: Point | null = null;

  return {
    applyOptions(patch) {
      // Merges one level deep only — `format` and `style` are replaced
      // wholesale (the rule and its reasoning are written once, in
      // `ConfigurablePluginApi`).
      current = { ...current, ...patch };
    },

    follow(position) {
      at = position;
    },

    /**
     * Describes the cursor's value in the axis's terms — the label
     * renderer does the actual drawing. x asks the mapping for the data x
     * back (yielding a time even for a bar-index axis), and y is read
     * off the scale of whichever pane the cursor is over — none if it's in
     * the gap between panes.
     */
    axisBadges({ x, panes, readStyle, formatX }) {
      if (!at || !showBadges()) return [];

      const { back, color } = resolveStyle(CROSSHAIR_BADGE_SPEC, readStyle);

      const badges: AxisBadge[] = [];

      if (showVertical()) {
        const position = magnetOn() ? snapX(at, x, panes) : at.x;
        badges.push({
          axis: "x",
          position,
          // The default wording is the axis's own — the option is only an override.
          label: (current.format?.x ?? formatX)(x.fromPixel(position)),
          back,
          color,
        });
      }

      if (showHorizontal()) {
        const cursor = at;
        const pane = panes.find(
          ({ area }) => cursor.y >= area.top && cursor.y <= area.bottom,
        );
        if (pane) {
          badges.push({
            axis: "y",
            position: at.y,
            // The y wording of whichever pane the cursor is over — ticks and badge are stamped with the same ruler.
            label: (current.format?.y ?? pane.formatValue)(
              pane.yScale.invert(at.y),
            ),
            back,
            color,
          });
        }
      }

      return badges;
    },

    draw(target, { area, readStyle, x, panes }) {
      if (!at) return;
      const verticalX = magnetOn() ? snapX(at, x, panes) : at.x;

      const style = resolveStyle(
        CROSSHAIR_STYLE_SPEC,
        readStyle,
        current.style,
      );

      if (showVertical() && verticalX >= area.left && verticalX <= area.right) {
        target.drawLine(
          [
            { x: verticalX, y: area.top },
            { x: verticalX, y: area.bottom },
          ],
          style,
        );
      }

      if (showHorizontal() && at.y >= area.top && at.y <= area.bottom) {
        target.drawLine(
          [
            { x: area.left, y: at.y },
            { x: area.right, y: at.y },
          ],
          style,
        );
      }
    },
  };
}

/**
 * The actual x (pixels) of the bar beneath the cursor. Falls back to the
 * raw cursor position when there's no registration or the cursor is
 * outside the pane.
 *
 * Goes by the first registration — when a pane's series sit on different x
 * grids, "that pane's primary series" is the answer, and that's whichever
 * registered first.
 */
function snapX(at: Point, x: XMapping, panes: readonly PaneApi[]): number {
  const pane = panes.find(({ area }) => contains(area, at));
  if (!pane) return at.x;

  const [sample] = pane.probe(x.fromPixel(at.x));
  return sample ? x.toPixel(sample.x) : at.x;
}

/**
 * A time-ghost cursor — a vertical line plus an x badge that carries over
 * only "what time is it looking at right now" from another chart's cursor
 * (the material `syncCrosshair` is built from). y is never carried over,
 * since each chart has its own scale — mimicking a horizontal line here
 * would be a lie.
 *
 * It holds only a data x — the pixel conversion is asked of the mapping at
 * draw time (`x.toPixel`), so it automatically stays right through
 * pan/zoom and points at the same moment even on a chart with a different
 * bar grid. It shares the crosshair's style tokens so it reads as the same
 * family on screen.
 */
export interface TimeCursor extends PlotDecoration {
  /** The data x to follow — `null` once the cursor has left. */
  follow(x: number | null): void;
}

export function timeCursor(): TimeCursor {
  let at: number | null = null;

  return {
    follow(x) {
      at = x;
    },

    draw(target, { area, readStyle, x }) {
      if (at === null) return;

      const pixel = x.toPixel(at);
      if (pixel < area.left || pixel > area.right) return;

      const style = resolveStyle(CROSSHAIR_STYLE_SPEC, readStyle);
      target.drawLine(
        [
          { x: pixel, y: area.top },
          { x: pixel, y: area.bottom },
        ],
        style,
      );
    },

    axisBadges({ x, readStyle, formatX }) {
      if (at === null) return [];

      const pixel = x.toPixel(at);
      const { back, color } = resolveStyle(CROSSHAIR_BADGE_SPEC, readStyle);
      // The badge speaks in the receiving chart's terms — the sending chart's format never reaches here.
      return [{ axis: "x", position: pixel, label: formatX(at), back, color }];
    },
  };
}

/**
 * A plugin that mounts a crosshair and feeds it the cursor.
 *
 * ```ts
 * const cursor = plot.use(crosshair({ horizontal: false }));
 * cursor.dispose();          // remove it by hand, or
 * plot.destroy();            // let Plot remove it for you
 * ```
 *
 * Why the decoration isn't left to subscribe to events on its own: that
 * would make the decoration need to know about `Plot`, growing its
 * contract from just `draw` into a whole lifecycle. Keeping the wiring
 * outside keeps the contract thin.
 */
export function crosshair(
  options: CrosshairLineOptions & DecorationOptions = {},
): Plugin<
  DecorationHost & RenderRequester & PlotEventSource,
  ConfigurablePluginApi<CrosshairLineOptions>
> {
  return (plot) => {
    const line = crosshairLine(options);

    // Changes **every frame** as it follows the cursor — of the built-in
    // decorations, this is the one thing running at pointer speed on the
    // side of the layer split.
    const removeDecoration = plot.addDecoration(line, { zIndex: options.zIndex });

    const unsubscribe = plot.on("crosshair", (payload) => {
      line.follow(payload?.pane ? payload.position : null);
      plot.requestRender();
    });

    const api = pluginApi(
      {
        /**
         * Changes only the options — doesn't rebuild. Reinstalling would
         * throw away the cursor's state, and the z position would get
         * pushed back in registration order. That's why `zIndex` isn't
         * here — it's a property of registration, so changing it means
         * actually mounting the decoration again.
         */
        applyOptions(patch: Partial<CrosshairLineOptions>) {
          if (api.disposed) {
            throw new ContractError("Cannot set options on a disposed crosshair");
          }
          line.applyOptions(patch);
          plot.requestRender();
        },
      },
      () => {
        unsubscribe();
        removeDecoration();
      },
    );

    return api;
  };
}
