/**
 * The declarative path for live ticks — does updating the `data` prop ride
 * core's live semantics unchanged?
 *
 * Three contracts (all extensions of the viewport-ownership rule —
 * the chart owns the viewport, data changes don't move it):
 * (1) Ticking the in-progress bar (replacing the last point) must not touch
 *     the viewport.
 * (2) A new bar being appended must not trigger a refit — this is where it
 *     diverges from the imperative `setData` (which does refit).
 * (3) With `shiftVisibleRangeOnNewBar` on and the last bar in view, the
 *     window shifts by exactly one new bar (`followNewBar`) — because the
 *     declarative feed arrives through the same data-change notification
 *     (`{data: true, refit: false}`).
 *
 * **Cost is not part of the contract.** This path is the full path with no
 * incremental detection (`entry.feed → load → manager.setData`, two copies
 * plus a full sort check).
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartLine, useChartPlot } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const MINUTE = 60_000;

function bars(count: number): LineDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i * MINUTE,
    y: 100 + Math.sin(i / 5) * 10,
  }));
}

function makeDeps() {
  return browserDeps({
    createLayers: layersSpy().createLayers,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
}

/** Live options get applied from inside the container — same option demo uses. */
function LiveOptions() {
  const plot = useChartPlot();
  useEffect(() => {
    plot.applyOptions({ shiftVisibleRangeOnNewBar: true });
  }, [plot]);
  return null;
}

function domainOf(plot: Plot | null): { startX: number; endX: number } {
  const domain = plot?.getVisibleRange();
  if (!domain) throw new Error('xDomain does not exist yet — this is before the first fit');
  return { startX: domain.min, endX: domain.max };
}

describe('declarative live data', () => {
  it('should keep the viewport on a last-bar tick and not refit on a new bar', async () => {
    const plotRef = createRef<Plot>();
    const initial = bars(100);

    const screen = render(
      <ChartContainer deps={makeDeps()} data={initial} plotRef={plotRef}>
        <ChartLine />
      </ChartContainer>,
    );

    const fitted = domainOf(plotRef.current);

    // (1) A tick on the in-progress bar — a new array with only the last point swapped.
    const ticked = initial.slice(0, -1).concat({
      ...initial[initial.length - 1],
      y: 250, // even with a big value jump
    });
    await act(async () => {
      screen.rerender(
        <ChartContainer deps={makeDeps()} data={ticked} plotRef={plotRef}>
          <ChartLine />
        </ChartContainer>,
      );
    });
    expect(domainOf(plotRef.current)).toEqual(fitted); // viewport unchanged

    // (2) A new bar — without the shift option, the window stays put too (no refit).
    const grown = ticked.concat({ x: 100 * MINUTE, y: 105 });
    await act(async () => {
      screen.rerender(
        <ChartContainer deps={makeDeps()} data={grown} plotRef={plotRef}>
          <ChartLine />
        </ChartContainer>,
      );
    });
    expect(domainOf(plotRef.current)).toEqual(fitted);
  });

  it('should follow a new bar when shiftVisibleRangeOnNewBar is on', async () => {
    const plotRef = createRef<Plot>();
    const initial = bars(100);

    const screen = render(
      <ChartContainer deps={makeDeps()} data={initial} plotRef={plotRef}>
        <LiveOptions />
        <ChartLine />
      </ChartContainer>,
    );

    const fitted = domainOf(plotRef.current);

    // One new bar — since the last bar was in view, the window shifts by exactly one bar.
    const grown = initial.concat({ x: 100 * MINUTE, y: 105 });
    await act(async () => {
      screen.rerender(
        <ChartContainer deps={makeDeps()} data={grown} plotRef={plotRef}>
          <LiveOptions />
          <ChartLine />
        </ChartContainer>,
      );
    });

    const shifted = domainOf(plotRef.current);
    expect(shifted.startX - fitted.startX).toBe(MINUTE);
    expect(shifted.endX - fitted.endX).toBe(MINUTE);

    // Once scrolled back into the past, the window isn't dragged along — the converse clause of followNewBar.
    const past = { startX: fitted.startX - 30 * MINUTE, endX: fitted.startX };
    await act(async () => {
      plotRef.current?.setVisibleRange(past.startX, past.endX);
    });
    const grownMore = grown.concat({ x: 101 * MINUTE, y: 106 });
    await act(async () => {
      screen.rerender(
        <ChartContainer deps={makeDeps()} data={grownMore} plotRef={plotRef}>
          <LiveOptions />
          <ChartLine />
        </ChartContainer>,
      );
    });
    expect(domainOf(plotRef.current)).toEqual(past);
  });
});
