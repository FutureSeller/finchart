import { ContractError, requireObject, requireOptionalBoolean } from "../primitives";
import type { PaneApi } from "../plot/pane";
import type { InputHost, PaneHost } from "../plot/capabilities";
import type { Plugin, PluginApi } from "../primitives";
import { pluginApi } from "../primitives";

/** Under the default 0, over axis drag's -100. */
const LAYOUT_GESTURE_PRIORITY = -50;

/**
 * The toggle and the gestures for a maximized pane. The state itself is the
 * chart's (`plot.maximizePane` / `plot.maximizedPane`): a layout mode the
 * height split reads, not a rewrite of any pane's `flex` — so there is no
 * snapshot to keep in step with the panes, and a divider drag, a removed
 * pane or a pane added meanwhile are handled where the layout is.
 *
 * Restoring via Esc is built in; toggling via a pane double-click is
 * opt-in — double-click already belongs to `doubleClickReset` (default
 * true), so consuming it here would silently kill that reset on every
 * pane click. That's why it only turns on with an explicit
 * `gestures: true`. Esc has no such owner, so when there's nothing to
 * restore it returns `false` and the chain continues.
 */
export interface PaneMaximizeApi extends PluginApi {
  /**
   * Lets `pane` fill the chart — the rest are laid out at their `minHeight`.
   * Given the pane already maximized, this is `restore()` (a toggle); given
   * another, the target moves.
   */
  maximize(pane: PaneApi): void;
  /** Gives the panes back their own split. Does nothing if not maximized. */
  restore(): void;
  /**
   * The currently maximized pane, `null` if none — the chart's
   * `maximizedPane`. A change rings `panesChange`, a lone pane included.
   */
  readonly maximizedPane: PaneApi | null;
}

export interface PaneMaximizeOptions {
  /**
   * Turns on the built-in gesture of toggling via a pane double-click.
   * Defaults to false — it overlaps `doubleClickReset`'s territory.
   * Restoring via Esc is always on regardless of this option.
   */
  gestures?: boolean;
}

/**
 * Picks one pane and grows it to fill the view — the rest collapse to
 * `minHeight`.
 *
 * ```ts
 * const max = plot.use(paneMaximize());
 * max.maximize(rsiPane);   // keep only RSI, collapse the rest
 * max.maximize(rsiPane);   // call it again to restore (toggle)
 * // Esc comes built in. Toggling via pane double-click is opt-in:
 * plot.use(paneMaximize({ gestures: true }));
 * ```
 *
 * `dispose()` takes the toggle and the gestures away and leaves the layout
 * as it is — `plot.maximizePane(null)` gives the split back.
 *
 * Esc and double-click reach it only after every consumer at the default
 * priority passed on them, so a drawing in progress or under the cursor
 * answers first wherever the tools were installed.
 */
export function paneMaximize(
  options: PaneMaximizeOptions = {},
): Plugin<PaneHost & InputHost, PaneMaximizeApi> {
  // Checked here, not on the first input event — a bad options object would
  // otherwise throw a raw TypeError on every key and click.
  requireObject(options, "paneMaximize(options)");
  requireOptionalBoolean(options.gestures, "paneMaximize gestures");
  return (plot) => {
    function live(): void {
      if (api.disposed) throw new ContractError("paneMaximize was disposed");
    }

    function maximize(pane: PaneApi): void {
      live();
      // A stale reference (a pane removed by an indicator toggle) is refused
      // here, in this plugin's words, before the chart's own check.
      if (!plot.panes.includes(pane)) {
        throw new ContractError("maximize(pane) needs a pane of this chart");
      }
      plot.maximizePane(plot.maximizedPane === pane ? null : pane);
    }

    function restore(): void {
      live();
      if (plot.maximizedPane !== null) plot.maximizePane(null);
    }

    // Restoring via Esc is always on — when there's nothing to restore, it
    // returns false and the chain continues (the same spot a drawing
    // tool's cancel/deselect occupies).
    //
    // Below the default priority: Esc and double-click mean "the thing under
    // my hand" first — a line being drawn, a drawing to select — and the
    // layout only when nothing on the chart claimed them. At the same
    // priority the plugin installed later went first, so the answer
    // depended on install order. Still above axis drag, which only claims
    // its own axis strip.
    const removeInputConsumer = plot.addInputConsumer({
      handle(event) {
        if (event.type === "keydown" && event.key === "Escape") {
          if (plot.maximizedPane === null) return false;
          restore();
          return true;
        }
        if (options.gestures && event.type === "dblclick") {
          const pane = plot.panes.find(
            ({ area }) =>
              event.point.x >= area.left &&
              event.point.x <= area.right &&
              event.point.y >= area.top &&
              event.point.y <= area.bottom,
          );
          if (!pane) return false;
          maximize(pane);
          return true;
        }
        return false;
      },
    }, { priority: LAYOUT_GESTURE_PRIORITY });

    const api = pluginApi(
      {
        maximize,
        restore,
        get maximizedPane(): PaneApi | null {
          return plot.maximizedPane;
        },
      },
      removeInputConsumer,
    );

    return api;
  };
}
