import type { Pane, PaneOptions, Scale } from '@finchart/core';
import { LinearScale, PANE_OPTION_DEFAULTS } from '@finchart/core';
import type { ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useReducer, useState } from 'react';
import { type ChartApi, type HeldPane, type PaneDeclaration, type PaneProps, PaneProvider, SeriesPlacementProvider, useChartApi, useJsxRank } from './chart-context';
import { createSeriesPlacement } from './series-collector';

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
  /**
   * Whether the value axis follows the data. Defaults to true. A directive,
   * not a lock: the user turning a fixed range on (an axis drag,
   * `setValueDomain`) turns this off on the pane, the way a divider drag
   * moves `flex` — the prop is applied when it changes, and only then.
   */
  autoScale?: boolean;
  /** Flip the value axis so larger values sit lower. Defaults to false. */
  invert?: boolean;
  /**
   * The value scale, as a factory. A log toggle is a change of this prop —
   * the pane, its series and its height stay. The factory is called on each
   * committed update, but its scale is installed only when `kind` changes.
   * An inline arrow is fine. Removing it puts back a
   * linear scale — on the main pane, the instance this replaced, carrying
   * whatever range the pane shows at that moment; that restore also runs
   * when this pane goes, and overwrites a `mainPane.setYScale` made while
   * this pane held it.
   */
  yScale?: () => Scale;
  /**
   * A fixed value range, `[min, max]` — an oscillator's 0..100. A directive
   * like `autoScale`: applied on mount and when the two numbers change
   * (a new array with the same values is no change), so the user's axis
   * drag in between stays. Setting it turns `autoScale` off; removing it
   * hands the axis back to `autoScale`.
   */
  valueDomain?: readonly [number, number];
  children?: ReactNode;
}

/**
 * A region sharing one value axis. Series placed inside it are drawn on
 * top of each other.
 *
 * The first `<ChartPane>` uses the `mainPane` a `Plot` always has,
 * as-is. Creating a new one instead would leave an empty `mainPane`
 * sitting at the top, taking up space for nothing. When the pane holding it
 * goes, the main pane stays on the chart without the series that were inside
 * this wrapper (series outside any pane stay on it): it goes back to the top
 * at the next restack, and the next `<ChartPane>` to arrive — mounted, or
 * shown again by `<Activity>` — takes it.
 *
 * A Suspense boundary hiding it leaves its pane on the chart as it is —
 * series, the user's divider drag and axis range, the components inside and
 * their state — so a component inside may suspend within the pane's own
 * boundary; showing it applies any prop that changed meanwhile. While hidden
 * it stays right after the pane it followed, whatever goes around it, so a
 * pane inserted between that one and it meanwhile sits after it until it
 * shows again; the reveal then puts the panes in JSX order. (React 19's
 * development StrictMode replays effects on the reveal: a pane hidden on its
 * own is rebuilt instead, the components inside it starting over, and a chart
 * hidden whole gets a new `Plot`.)
 *
 * An `<Activity>` hiding it takes the pane off the chart (a main pane it
 * holds stays, with its own scale back), and showing it builds the pane
 * afresh from the props it has then, in its JSX place: what the user did to
 * the old pane does not come back, and the components inside it start over.
 */
export function ChartPane({
  // **Removing a prop reverts to the default.** The defaults are exported
  // as one set by the core — copying the numbers here would let just this
  // line go stale when the core changes.
  flex = PANE_OPTION_DEFAULTS.flex,
  minHeight = PANE_OPTION_DEFAULTS.minHeight,
  valuePadding = PANE_OPTION_DEFAULTS.valuePadding,
  autoScale = PANE_OPTION_DEFAULTS.autoScale,
  invert = PANE_OPTION_DEFAULTS.invert,
  yScale,
  valueDomain,
  children,
}: ChartPaneProps) {
  const api = useChartApi('ChartPane');
  const id = useId();
  // Reserve the subtree's JSX position even before this pane is on the chart.
  const rank = useJsxRank(id);
  const [, rerender] = useReducer((round: number) => round + 1, 0);
  // Without a rank yet — this pane's own state switched it on, or a Suspense
  // reveal rendered it after its owner's pass already ran — it sits last
  // until its owner's corrective pass, which React renders in the same batch.
  const placementRank = rank ?? [Number.MAX_SAFE_INTEGER];
  const placement = createSeriesPlacement(placementRank, rerender);
  const [pane, show] = useState<Pane | null>(null);

  // Built per render, so declaring one render twice (StrictMode's replay, a
  // reveal) is no change, and a render the props moved in is one.
  const declaration: PaneDeclaration = {
    rank: placementRank,
    props: { flex, minHeight, valuePadding, autoScale, invert, yScale, valueDomain },
    build: (main) => holdPane(api, main, declaration, show),
  };

  /**
   * Declared from a layout effect, so a pane arriving is built, ranked and
   * handed over before the browser paints, and a moved prop lands in the
   * same commit. Released from a passive cleanup: unmounting, a keyed swap
   * and `<Activity>` hiding run it, a Suspense boundary hiding the pane does
   * not — the pane stays, as do the components inside it and what the user
   * did to it. Taking it off there would stop it rendering its children, the
   * component that suspended among them, and the boundary would show it
   * again only for that component to suspend again, without end.
   *
   * The cleanups are keyed on the chart and this wrapper's id, so a
   * re-render reads as nothing leaving and nothing coming back; only the
   * declaration runs every render.
   */
  useLayoutEffect(() => () => api.declarePane(id, null), [api, id]);
  useLayoutEffect(() => {
    api.declarePane(id, declaration);
  });
  useEffect(() => () => api.releasePane(id), [api, id]);

  // Children claim their slot here during the render phase, and it goes to the pane after commit.
  const collector = pane ? api.seriesCollector(pane) : null;

  // This pane gets applied even when a child skips rendering via `React.memo`.
  useEffect(() => {
    placement.commit();
    collector?.flush();
  });

  if (!pane) return null;

  return <PaneProvider value={pane}>
    <SeriesPlacementProvider value={placement}>{children}</SeriesPlacementProvider>
  </PaneProvider>;
}

/** Puts a declared pane on the chart and keeps what letting it go needs. */
function holdPane(api: ChartApi, main: boolean, first: PaneDeclaration, show: (pane: Pane | null) => void): HeldPane {
  const { plot } = api;
  const { yScale, valueDomain, ...options } = first.props;
  // The main pane's own scale while this wrapper's `yScale` replaces it — put
  // back when the prop or this wrapper goes, so a keyed swap to a pane
  // without `yScale` returns to what was there. A weaker ownership than a
  // pane's series list has: the core *refuses* a second series owner, but it
  // cannot tell a wrapper's `setYScale` from a consumer's, so a swap made
  // while this wrapper holds the main pane is overwritten on release. What
  // comes back is the instance, not its old domain — `setYScale` writes the
  // current range onto it.
  let own: Scale | null = null;
  /** Installs `scale`, or with `undefined` the default: the main pane's own instance, else linear as `addPane` builds it. */
  const swap = (scale: Scale | undefined): void => {
    if (!main) {
      pane.setYScale(scale ?? new LinearScale());
    } else if (scale) {
      own ??= pane.yScale;
      pane.setYScale(scale);
    } else if (own) {
      pane.setYScale(own);
      own = null;
    }
  };
  // A new pane is built with its options, so the chart announces it once.
  const pane = main ? plot.mainPane : plot.addPane(yScale ? { ...options, yScale: yScale() } : options);
  if (main) {
    pane.applyOptions(options);
    if (yScale) swap(yScale());
  }
  if (valueDomain) pane.setValueDomain(valueDomain[0], valueDomain[1]);
  let last = first;
  let built = true;
  show(pane);

  return {
    pane,
    update(next) {
      if (next === last) return;
      applyMoved(pane, last.props, next.props, built, swap);
      last = next;
      built = false;
    },
    release() {
      show(null);
      if (!main) {
        plot.removePane(pane);
        return;
      }
      // The main pane stays, unclaimed — series outside any pane share it.
      // The series inside this wrapper took themselves off in the same
      // passive cleanups that released it.
      swap(undefined);
    },
  };
}

/**
 * A held pane's later props: only the fields that moved since the last
 * ones — writing every prop back would undo what the user did in between: a
 * divider drag (`flex`), a fixed range (`autoScale`). `built` says `last`
 * are the props the pane was built from.
 */
function applyMoved(
  pane: Pane,
  last: PaneProps,
  next: PaneProps,
  built: boolean,
  swap: (scale: Scale | undefined) => void,
): void {
  // A fixed range wins while it's there — the autoScale prop waits for it to go.
  const patch: PaneOptions = {};
  if (last.flex !== next.flex) patch.flex = next.flex;
  if (last.minHeight !== next.minHeight) patch.minHeight = next.minHeight;
  if (last.valuePadding !== next.valuePadding) patch.valuePadding = next.valuePadding;
  if (!next.valueDomain && last.autoScale !== next.autoScale) patch.autoScale = next.autoScale;
  if (last.invert !== next.invert) patch.invert = next.invert;
  if (Object.keys(patch).length > 0) pane.applyOptions(patch);

  // Called on every later commit the pane renders in, but for the one that
  // hands the pane over with the factory it was just built from; its scale
  // is installed only when the kind changes, so an inline arrow is fine.
  if (next.yScale) {
    if (!built || next.yScale !== last.yScale) {
      const scale = next.yScale();
      if (scale.kind !== pane.yScale.kind) swap(scale);
    }
  } else if (last.yScale) {
    swap(undefined);
  }

  // Compared as two numbers, so an inline `[0, 100]` is no change. Once a
  // fixed range goes, the pane does what `autoScale` says — read now, never
  // a reason to re-pin the range.
  const [min, max] = next.valueDomain ?? [];
  const [lastMin, lastMax] = last.valueDomain ?? [];
  if (min === lastMin && max === lastMax) return;
  if (min !== undefined && max !== undefined) pane.setValueDomain(min, max);
  else if (next.autoScale) pane.resetValueAxis();
}
