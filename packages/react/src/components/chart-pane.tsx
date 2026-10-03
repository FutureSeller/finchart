import type { Pane, PaneOptions, Scale } from '@finchart/core';
import { PANE_OPTION_DEFAULTS } from '@finchart/core';
import type { ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PaneProvider, SeriesPlacementProvider, useChartApi, useSeriesPlacement } from './chart-context';
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
   * the pane, its series and its height stay: when the factory's identity
   * changes it is called, and the scale is swapped only if it hands out
   * another kind than the pane holds, so an inline `() => new LogScale()`
   * costs one allocation a render and never a swap; the factory must be
   * pure. Removing it puts back a linear scale — on the main pane, the
   * instance this replaced, carrying whatever range the pane shows at that
   * moment; that restore also runs when this pane goes, and overwrites a
   * `mainPane.setYScale` made while this pane held it.
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
 * sitting at the top, taking up space for nothing.
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
  const placementId = useId();
  const parentPlacement = useSeriesPlacement();
  // Reserve the subtree's JSX position even before this pane is acquired.
  const prefix = parentPlacement?.place(placementId);
  const placement = createSeriesPlacement(prefix ?? [Number.MAX_SAFE_INTEGER]);
  // biome-ignore lint/suspicious/noExplicitAny: the context erases the data type
  const [pane, setPane] = useState<Pane | null>(null);

  /**
   * The initial options are **carried in the acquire call** — the pane
   * arrives already laid out, so the chart announces it once instead of
   * once with the defaults and again with the props.
   */
  const initialOptions = useRef({ flex, minHeight, valuePadding, autoScale, invert, yScale });

  useEffect(() => {
    const acquired = api.acquirePane(initialOptions.current);
    setPane(acquired);

    return () => {
      setPane(null);
      api.releasePane(acquired);
    };
  }, [api]);

  // Where this pane sits in the JSX, every commit — a sibling inserted above
  // or a keyed reorder moves it. Every pane's layout effect runs before any
  // pane's passive one, so the first `stackPanes` of a commit sees all the
  // ranks and the chart restacks once, not once per sibling.
  useLayoutEffect(() => {
    if (pane && prefix) api.rankPane(pane, prefix);
  });
  useEffect(() => {
    api.stackPanes();
  });

  // After that, only the field that actually changed gets applied —
  // recreating the pane every time a value changes would unregister
  // every series inside it along with it, and writing every prop back on
  // any change would undo what the user did in between: a divider drag
  // (`flex`), a fixed range (`autoScale`). The first pass was `acquire`'s.
  const applied = useRef<PaneFields | null>(null);
  useEffect(() => {
    if (!pane) return;
    const next: PaneFields = { flex, minHeight, valuePadding, autoScale, invert };
    const last = applied.current;
    applied.current = next;
    if (!last) return;
    const patch = changedFields(last, next);
    if (patch) pane.applyOptions(patch);
  }, [pane, flex, minHeight, valuePadding, autoScale, invert]);

  // The scale the acquisition built is the first pass; after that, a new factory is a swap.
  const scaleApplied = useRef<Pane | null>(null);
  useEffect(() => {
    if (!pane) return;
    if (scaleApplied.current !== pane) {
      scaleApplied.current = pane;
      return;
    }
    api.swapPaneScale(pane, yScale);
  }, [api, pane, yScale]);

  // Compared as two numbers, so an inline `[0, 100]` is no change.
  const domainMin = valueDomain?.[0];
  const domainMax = valueDomain?.[1];
  const domainSet = useRef(false);
  useEffect(() => {
    if (!pane) return;
    if (domainMin !== undefined && domainMax !== undefined) {
      pane.setValueDomain(domainMin, domainMax);
      domainSet.current = true;
    } else if (domainSet.current) {
      domainSet.current = false;
      pane.resetValueAxis();
    }
  }, [pane, domainMin, domainMax]);

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

type PaneFields = Required<Pick<PaneOptions, 'flex' | 'minHeight' | 'valuePadding' | 'autoScale' | 'invert'>>;

/** The fields whose prop value moved since the last pass — `null` when none did. */
function changedFields(last: PaneFields, next: PaneFields): PaneOptions | null {
  const patch: PaneOptions = {};
  let any = false;
  if (last.flex !== next.flex) {
    patch.flex = next.flex;
    any = true;
  }
  if (last.minHeight !== next.minHeight) {
    patch.minHeight = next.minHeight;
    any = true;
  }
  if (last.valuePadding !== next.valuePadding) {
    patch.valuePadding = next.valuePadding;
    any = true;
  }
  if (last.autoScale !== next.autoScale) {
    patch.autoScale = next.autoScale;
    any = true;
  }
  if (last.invert !== next.invert) {
    patch.invert = next.invert;
    any = true;
  }
  return any ? patch : null;
}
