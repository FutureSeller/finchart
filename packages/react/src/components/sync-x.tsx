import type { Plot } from '@finchart/core';
import { syncCrosshair, syncX } from '@finchart/core';
import { useEffect, useRef } from 'react';

export interface SyncXProps {
  /**
   * The charts to link — pass the state `<ChartContainer onPlot>` handed
   * up, as-is.
   *
   * **The length can change.** A chart that hasn't mounted yet can sit as
   * `null`, and the array can grow as you add comparison symbols — both
   * cases get rewired.
   */
  plots: ReadonlyArray<Plot | null>;
}

/**
 * Folds the list's **contents and length** into one value.
 *
 * Passing the array straight through as deps (`useEffect(fn, plots)`) only
 * gets React's `areHookInputsEqual` as far as `i < prev.length && i <
 * next.length` — it **can't see a length change** (that's just a dev-mode
 * warning, not a mismatch). Add a comparison symbol so `[primary]` becomes
 * `[primary, comparison]`, and the shared prefix stays the same, so the
 * effect never re-runs and the new chart never makes it into `syncX`.
 * Shrinking is worse — the disposer for the chart that left never gets
 * called, so decorations and handlers stay attached to a destroyed `Plot`.
 *
 * Folding by identity is necessary because `Plot` has no stable id — the
 * reference itself is the identity, and turning it into one string
 * together with its slot captures length, order, and replacement all in a
 * single value.
 */
function usePlotsKey(plots: SyncXProps["plots"]): string {
  // Build it lazily — `useRef(new WeakMap())` would construct a WeakMap
  // **every render** only to throw it away (the argument is evaluated
  // every time). Build it only on the first render.
  const seen = useRef<WeakMap<Plot, number> | null>(null);
  seen.current ??= new WeakMap<Plot, number>();
  const registry = seen.current;
  const next = useRef(0);

  return plots
    .map((plot) => {
      if (plot === null) return "-";
      let id = registry.get(plot);
      if (id === undefined) {
        id = (next.current += 1);
        registry.set(plot, id);
      }
      return String(id);
    })
    .join(",");
}

/**
 * Syncs the x range **between** containers — the wiring for a symbol
 * comparison screen.
 *
 * The only chart component that lives outside a container: the vocabulary
 * inside assumes a single chart, so linking two or more lives outside.
 * Does nothing with fewer than two live charts, and unlinks and relinks
 * whenever the list changes — `plotRef` can't support this rewiring (the
 * key-remount trap).
 *
 * ```tsx
 * <SyncX plots={[primary, ...comparisons]} />
 * ```
 */
export function SyncX({ plots }: SyncXProps) {
  const key = usePlotsKey(plots);
  const latest = useRef(plots);
  latest.current = plots;

  useEffect(() => {
    const [hub, second, ...rest] = latest.current.filter(
      (plot): plot is Plot => plot !== null,
    );
    if (!hub || !second) return; // Fewer than two live charts — nothing to link

    return syncX(hub, second, ...rest);
    // The key to rewiring is the list's **contents and length** — `key` captures both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

/**
 * Syncs the cursor's **time** — the hovered chart's timestamp shows up on
 * the other charts as a ghost cursor (a vertical line + x badge). Same
 * contract as `<SyncX>`: relinks when the list changes. Usually placed
 * alongside each other.
 *
 * ```tsx
 * <SyncX plots={plots} />
 * <SyncCrosshair plots={plots} />
 * ```
 */
export function SyncCrosshair({ plots }: SyncXProps) {
  const key = usePlotsKey(plots);
  const latest = useRef(plots);
  latest.current = plots;

  useEffect(() => {
    const [hub, second, ...rest] = latest.current.filter(
      (plot): plot is Plot => plot !== null,
    );
    if (!hub || !second) return;

    return syncCrosshair(hub, second, ...rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
