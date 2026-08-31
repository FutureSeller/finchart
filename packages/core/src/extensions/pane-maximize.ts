import { asFinite, asIndex } from "../primitives";
import type { PaneApi } from "../plot/pane";
import type { InputHost, PaneHost, PlotEventSource } from "../plot/capabilities";
import type { Plugin, PluginApi } from "../primitives";
import { pluginApi } from "../primitives";

/**
 * Collapses every pane but one — via `flex: 0`. This doesn't invent a
 * "big flex": `distributeHeights` treats a flex-0 pane as starved and
 * pins it to `minHeight`, so the target pane, left with its own flex
 * untouched, becomes the sole flex claimant and takes all the remaining
 * space.
 *
 * This doesn't go into `ChartState` — unlike crosshair, it writes
 * `pane.flex` directly and so already touches the state surface, so
 * instead this plugin owns its own serialization channel (the same
 * precedent as `@finchart/tools`). With no pane id yet, the target is
 * addressed by its index into `plot.panes` — index identity is fragile
 * when panes are added or removed, which doesn't suit `ChartState`,
 * but is enough for a self-format the consumer round-trips themselves.
 *
 * It never fights the divider drag for ownership — if flex changes from
 * outside while maximized, that change becomes the new truth and the
 * snapshot is discarded without restoring. If a pane disappears, only the
 * surviving panes get restored from the snapshot.
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
   * Collapses every pane but `pane` to `flex: 0`. If already maximized
   * and given the same pane again, this is equivalent to `restore()`
   * (a toggle); given a different pane, only the target changes — the
   * snapshot from the first maximization stays and gets swapped in.
   */
  maximize(pane: PaneApi): void;
  /** Restores every pane's pre-maximization flex. Does nothing if not maximized. */
  restore(): void;
  /** The currently maximized pane. `null` if none. */
  readonly maximizedPane: PaneApi | null;
  /** Round-trips the maximization state as a string. `null` if not maximized. */
  serialize(): string | null;
  /**
   * The other side of the round trip. Returns `false` rather than
   * throwing if it can't be read — a value coming from a URL or
   * `localStorage` may belong to a different pane configuration.
   */
  load(payload: string): boolean;
}

interface Snapshot {
  target: PaneApi;
  flexByPane: ReadonlyMap<PaneApi, number>;
}

const FORMAT_VERSION = 1;

interface SerializedMaximize {
  version: number;
  targetIndex: number;
  flex: number[];
}

function serializeSnapshot(
  panes: readonly PaneApi[],
  snapshot: Snapshot,
): string | null {
  const targetIndex = panes.indexOf(snapshot.target);
  if (targetIndex === -1) return null;

  const payload: SerializedMaximize = {
    version: FORMAT_VERSION,
    targetIndex,
    flex: panes.map((pane) => snapshot.flexByPane.get(pane) ?? pane.flex),
  };
  return JSON.stringify(payload);
}

function parseSnapshot(
  panes: readonly PaneApi[],
  payload: string,
): { target: PaneApi; flex: readonly number[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, targetIndex, flex } = parsed as Partial<SerializedMaximize>;
  if (version !== FORMAT_VERSION) return null;

  // Finiteness alone isn't enough for an index — checking only
  // `0 <= v < length` would let a fractional index through, making
  // panes[0.5] undefined, and load would do nothing while returning true.
  const index = asIndex(targetIndex, panes.length);
  if (index === undefined) return null;

  if (!Array.isArray(flex) || flex.length !== panes.length) return null;
  // NaN, Infinity, and negative flex are blocked here — letting them
  // through would have load plant the snapshot and then either have
  // pane.applyOptions throw inside applyMaximization, or leave
  // maximizedPane claiming success while only half-applied.
  if (!flex.every((value) => (asFinite(value) ?? -1) >= 0)) return null;

  return { target: panes[index], flex };
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
 * The host is nothing more than `PaneHost & PlotEventSource & InputHost` —
 * zero changes to core. It reads via `plot.panes` and writes via
 * `pane.applyOptions`; re-render and layout recomputation are scheduled
 * automatically, since `Plot` already subscribes to every pane.
 */
export function paneMaximize(
  options: PaneMaximizeOptions = {},
): Plugin<PaneHost & PlotEventSource & InputHost, PaneMaximizeApi> {
  return (plot) => {
    let snapshot: Snapshot | null = null;
    // A reentrancy guard so a `stateChange` fired by our own write isn't
    // mistaken for "something changed from outside" — since everything is
    // synchronous, this flag alone is enough.
    let applying = false;

    /**
     * The target gets the snapshot's original flex, everything else gets
     * 0. The target is touched too because of target swaps — it may
     * already have been collapsed to 0 by a previous maximization, so
     * leaving it alone would change the target without changing the
     * screen.
     */
    function applyMaximization(
      target: PaneApi,
      flexByPane: ReadonlyMap<PaneApi, number>,
    ): void {
      applying = true;
      try {
        for (const pane of plot.panes) {
          const flex = pane === target ? flexByPane.get(pane) ?? pane.flex : 0;
          if (pane.flex !== flex) pane.applyOptions({ flex });
        }
      } finally {
        applying = false;
      }
    }

    function applySnapshot(flexByPane: ReadonlyMap<PaneApi, number>): void {
      applying = true;
      try {
        for (const [pane, flex] of flexByPane) {
          if (plot.panes.includes(pane) && pane.flex !== flex) {
            pane.applyOptions({ flex });
          }
        }
      } finally {
        applying = false;
      }
    }

    function maximize(pane: PaneApi): void {
      if (snapshot?.target === pane) {
        restore();
        return;
      }
      // A swap reuses the first snapshot as-is — intermediate maximizations pass through without restoring.
      const flexByPane =
        snapshot?.flexByPane ?? new Map(plot.panes.map((p) => [p, p.flex]));
      snapshot = { target: pane, flexByPane };
      applyMaximization(pane, flexByPane);
    }

    function restore(): void {
      if (!snapshot) return;
      const { flexByPane } = snapshot;
      snapshot = null;
      applySnapshot(flexByPane);
    }

    const unsubscribe = plot.on("stateChange", () => {
      if (applying || !snapshot) return;

      if (!plot.panes.includes(snapshot.target)) {
        // The target is gone (a runtime indicator toggle, etc.) — restore only the surviving panes.
        const survivors = new Map(
          [...snapshot.flexByPane].filter(([pane]) => plot.panes.includes(pane)),
        );
        snapshot = null;
        applySnapshot(survivors);
        return;
      }

      const divergedElsewhere = plot.panes.some(
        (pane) => pane !== snapshot!.target && pane.flex !== 0,
      );
      if (divergedElsewhere) {
        // flex changed from outside (a divider drag, etc.) — that's the new truth.
        // Don't restore over it: the layout the user just arranged must not be erased.
        snapshot = null;
      }
    });

    // Restoring via Esc is always on — when there's nothing to restore, it
    // returns false and the chain continues (the same spot a drawing
    // tool's cancel/deselect occupies).
    const removeInputConsumer = plot.addInputConsumer({
      handle(event) {
        if (event.type === "keydown" && event.key === "Escape") {
          if (!snapshot) return false;
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
    });

    const api = pluginApi(
      {
        maximize,
        restore,
        get maximizedPane(): PaneApi | null {
          return snapshot?.target ?? null;
        },
        serialize(): string | null {
          return snapshot ? serializeSnapshot(plot.panes, snapshot) : null;
        },
        load(payload: string): boolean {
          const parsed = parseSnapshot(plot.panes, payload);
          if (parsed === null) return false;

          const flexByPane = new Map(
            plot.panes.map((pane, index) => [pane, parsed.flex[index]]),
          );
          snapshot = { target: parsed.target, flexByPane };
          applyMaximization(parsed.target, flexByPane);
          return true;
        },
      },
      () => {
        unsubscribe();
        removeInputConsumer();
      },
    );

    return api;
  };
}
