import type {
  Marker,
  MarkersDecoration,
  PriceLineDecoration,
  PriceLineOptions,
  SpanOptions,
  WatermarkOptions,
} from '@finchart/core';
import { markers, priceLine, span, watermark } from '@finchart/core';
import { useContext, useEffect, useRef } from 'react';
import { shallowEqual } from '../shallow-equal';
import { PaneContextValue, useChartApi } from './chart-context';

/**
 * The React face of the standard decoration set. Mount adds it, unmount
 * removes it. `<PriceLine>` and `<Markers>` add theirs once per target and
 * hand changed props to the decoration in place; `<Watermark>` and
 * `<Span>` still remount when their values change.
 *
 * **Doesn't touch the decoration when the values are unchanged.** Using
 * the props object that JSX freshly allocates every render as the deps,
 * as-is, would hand the decoration a new snapshot and ask for a frame on
 * every render no matter what the consumer does — a single
 * `<PriceLine value={last} />` would validate and request a render 60
 * times a second for nothing (and `<Watermark>`/`<Span>` would remount).
 * The consumer has nothing to pin, so instead of pushing that contract
 * onto them, **the comparison happens here, by value.**
 */

/**
 * Returns the **same reference** when the values are equal — safe to use
 * directly as deps.
 *
 * **Nested objects are compared by value too** — a field like
 * `PriceLineOptions.style` is sometimes `Partial<LineStyle>` (a nested
 * object), and checking only one level would let the most common usage
 * (`<PriceLine style={{ color: 'red' }} />`) leak through as a redundant
 * update and render request on every render.
 *
 * **A plain object goes one level deeper.** Two reasons the depth is
 * capped at 1: the nesting in the currently public decoration options is
 * exactly one level, and descending into a consumer's object indefinitely
 * wouldn't stop on a circular reference.
 *
 * Arrays (`Markers`'s `items`) are compared only down to **element
 * identity** — this catches data built from something stable and misses
 * data that constructs a new object every time. A deep comparison would
 * make the comparison itself more expensive than drawing on a large
 * list.
 *
 * **Only function props can't be compared by value**
 * (`PriceLineOptions.format`). Whether two closures do the same thing
 * can't be decided, so it falls back to identity — an inline function is
 * a change every render. For `<PriceLine>` that costs one `setOptions` and
 * a render request per render, not a reinstall; pinning it with
 * `useCallback` or a module-level constant makes it free.
 */
function useStable<T>(value: T): T {
  const held = useRef(value);
  if (!shallowEqual(held.current, value)) held.current = value;
  return held.current;
}

/*
 * **Names the props types.** All three take the core's `*Options`
 * directly, but get a name findable straight from `@finchart/react`, like
 * their siblings `MarkersProps`, `XAxisProps`, `CrosshairProps`.
 */
export type PriceLineProps = PriceLineOptions;
export type WatermarkProps = WatermarkOptions;
export type SpanProps = SpanOptions;

/** A horizontal price line. Inside a `<ChartPane>`, that pane; outside one, `mainPane`. */
export function PriceLine(props: PriceLineProps) {
  const { plot } = useChartApi('PriceLine');
  const pane = useContext(PaneContextValue);
  const options = useStable(props);
  // One registration for the life of the component on its target; a changed
  // value is handed to the decoration in place — the "last price" line
  // follows every tick without a remove/add pair per tick.
  // `applied` is the snapshot the decoration currently holds, so the update
  // effect can skip the commit that installed it. The install effect leaves
  // `options` out of its deps on purpose: it runs only when the target
  // changes, and the closure of that render already holds the current
  // props — the installation bookkeeping writes nothing during render.
  const installed = useRef<{ line: PriceLineDecoration; applied: PriceLineOptions } | null>(null);

  useEffect(() => {
    const target = pane ?? plot.mainPane;
    const line = priceLine(options);
    installed.current = { line, applied: options };
    const remove = target.addDecoration(line);
    plot.requestRender();
    return () => {
      installed.current = null;
      remove();
      plot.requestRender();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, pane]);

  useEffect(() => {
    const held = installed.current;
    if (!held || held.applied === options) return;
    held.applied = options;
    // Props are a snapshot, not a patch — a label no longer given is gone.
    held.line.setOptions(options);
    plot.requestRender();
  }, [plot, options]);

  return null;
}

/**
 * `<Markers>`'s props — **named.**
 *
 * The only public component whose props type used to be anonymous, which
 * meant a wrapper couldn't name its own props type. Its siblings
 * (`ChartPaneProps`, `ChartSeriesProps`) all have names.
 */
export interface MarkersProps {
  items: readonly Marker[];
}

export function Markers({ items }: MarkersProps) {
  const { plot } = useChartApi('Markers');
  const pane = useContext(PaneContextValue);
  const stable = useStable(items);
  const installed = useRef<{ dots: MarkersDecoration; applied: readonly Marker[] } | null>(null);

  useEffect(() => {
    const target = pane ?? plot.mainPane;
    const dots = markers(stable);
    installed.current = { dots, applied: stable };
    const remove = target.addDecoration(dots);
    plot.requestRender();
    return () => {
      installed.current = null;
      remove();
      plot.requestRender();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, pane]);

  useEffect(() => {
    const held = installed.current;
    if (!held || held.applied === stable) return;
    held.applied = stable;
    held.dots.setItems(stable);
    plot.requestRender();
  }, [plot, stable]);

  return null;
}

export function Watermark(props: WatermarkProps) {
  const { plot } = useChartApi('Watermark');
  const options = useStable(props);

  useEffect(() => plot.addDecoration(watermark(options)), [plot, options]);

  return null;
}

export function Span(props: SpanProps) {
  const { plot } = useChartApi('Span');
  const options = useStable(props);

  useEffect(() => plot.addDecoration(span(options)), [plot, options]);

  return null;
}
