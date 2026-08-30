import type { Pane } from '@finchart/core';
import { PANE_OPTION_DEFAULTS } from '@finchart/core';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { PaneProvider, useChartApi } from './chart-context';

/*
 * There's no `axis` prop here. With two doors for configuring the value
 * axis — this one and a `<YAxis>` inside the pane — both would call
 * `pane.applyOptions({axis})` with a spread merge, and **whichever runs
 * later erases the other's setting** — on mount, the child effect runs
 * first so `<YAxis>` wins, but change an unrelated value like `flex` and
 * this component's effect runs, flipping it the other way. With no
 * actual use case, this was removed instead of building machinery to
 * reconcile the two doors — use a `<YAxis>` outside the pane if you need
 * this.
 */
export interface ChartPaneProps {
  /** The share of leftover vertical space this takes. Defaults to 1. */
  flex?: number;
  /** Won't shrink below this (px). Defaults to 40. */
  minHeight?: number;
  /** Padding that keeps the value axis from hugging the data. Defaults to 0.1 */
  valuePadding?: number;
  children?: ReactNode;
}

/**
 * A region sharing one value axis. Series placed inside it are drawn on
 * top of each other.
 *
 * The first `<ChartPane>` uses the `mainPane` a `Plot` always has,
 * as-is. Creating a new one instead would leave an empty `mainPane`
 * sitting at the top, taking up space for nothing.
 */
export function ChartPane({
  // **Removing a prop reverts to the default.** The defaults are exported
  // as one set by the core — copying the numbers here would let just this
  // line go stale when the core changes.
  flex = PANE_OPTION_DEFAULTS.flex,
  minHeight = PANE_OPTION_DEFAULTS.minHeight,
  valuePadding = PANE_OPTION_DEFAULTS.valuePadding,
  children,
}: ChartPaneProps) {
  const api = useChartApi('ChartPane');
  // biome-ignore lint/suspicious/noExplicitAny: the context erases the data type
  const [pane, setPane] = useState<Pane | null>(null);

  /**
   * The initial options are **carried in the acquire call.** Applying
   * them separately would open a gap in that one commit where the
   * container's pane restoration slice (applied after the
   * structure-change commit) arrives first, only to get overwritten by
   * the initial options landing late — sending the restored `flex` back
   * to the mount default.
   */
  const initialOptions = useRef({ flex, minHeight, valuePadding });

  useEffect(() => {
    const acquired = api.acquirePane(initialOptions.current);
    setPane(acquired);

    return () => {
      setPane(null);
      api.releasePane(acquired);
    };
  }, [api]);

  // After that, only props that actually changed get applied —
  // recreating the pane every time a value changes would unregister
  // every series inside it along with it. The first pass was already
  // done by `acquire`.
  const applied = useRef(false);
  useEffect(() => {
    if (!pane) return;
    if (!applied.current) {
      applied.current = true;
      return;
    }
    pane.applyOptions({ flex, minHeight, valuePadding });
  }, [pane, flex, minHeight, valuePadding]);

  // Children claim their slot here during the render phase, and it goes to the pane after commit.
  const collector = pane ? api.seriesCollector(pane) : null;
  collector?.begin();

  // This pane gets applied even when a child skips rendering via `React.memo`.
  useEffect(() => {
    collector?.flush();
  });

  if (!pane) return null;

  return <PaneProvider value={pane}>{children}</PaneProvider>;
}
