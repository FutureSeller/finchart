import type {
  Marker,
  PriceLineOptions,
  SpanOptions,
  WatermarkOptions,
} from '@finchart/core';
import { markers, priceLine, span, watermark } from '@finchart/core';
import { useContext, useEffect, useRef } from 'react';
import { PaneContextValue, useChartApi } from './chart-context';

/**
 * The React face of the standard decoration set. All the same shape —
 * mount adds it, unmount removes it.
 *
 * **Doesn't rebuild when the values are unchanged.** Using the props
 * object that JSX freshly allocates every render as the deps, as-is, would
 * reinstall on every render no matter what the consumer does — a single
 * `<PriceLine price={last} color="red" />` would fire `remove()` +
 * `addDecoration()` + `requestRender()` every tick (60 times a second).
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
 * (`<PriceLine style={{ color: 'red' }} />`) leak through as a reinstall
 * on every render.
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
 * can't be decided, so it falls back to identity — an inline function
 * still reinstalls every time, so the consumer has to pin it with
 * `useCallback` or a module-level constant.
 */
function useStable<T>(value: T): T {
  const held = useRef(value);
  if (!shallowEqual(held.current, value)) held.current = value;
  return held.current;
}

/** Is this a plain object — not an array, function, or null. The kind that gets one level deeper. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shallowEqual(a: unknown, b: unknown, depth = 1): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => Object.is(item, b[index]));
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key];
    const right = b[key];
    if (Object.is(left, right)) return true;
    // Just one level further — a nested option like `style` gets caught here by value.
    if (depth > 0 && isPlainObject(left) && isPlainObject(right)) {
      return shallowEqual(left, right, depth - 1);
    }
    return false;
  });
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

  useEffect(() => {
    const target = pane ?? plot.mainPane;
    const remove = target.addDecoration(priceLine(options));
    plot.requestRender();
    return () => {
      remove();
      plot.requestRender();
    };
  }, [plot, pane, options]);

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

  useEffect(() => {
    const target = pane ?? plot.mainPane;
    const remove = target.addDecoration(markers(stable));
    plot.requestRender();
    return () => {
      remove();
      plot.requestRender();
    };
  }, [plot, pane, stable]);

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
