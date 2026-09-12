/**
 * `<Tooltip formatRow>` and `<Legend formatRow>` forward the row formatter to
 * the DOM plugins — install and later change. A candle describes its rows,
 * so the overlay text is the observable.
 */
import type { OHLC, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartCandles, ChartContainer, Legend, Tooltip } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const candles: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105, volume: 1200 },
  { x: 5, open: 105, high: 112, low: 101, close: 102, volume: 800 },
  { x: 10, open: 102, high: 108, low: 99, close: 107, volume: 950 },
];

function setup() {
  const spy = layersSpy();
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
  const ref = createRef<Plot>();
  const plot = () => {
    if (!ref.current) throw new Error('plot is not mounted');
    return ref.current;
  };
  const overlay = () => {
    const layers = spy.created[spy.created.length - 1];
    const element = layers?.overlay;
    if (!(element instanceof HTMLElement)) throw new Error('no overlay');
    return element;
  };
  // A frame first — the panes have no area until the plot has laid out once.
  const hover = () => {
    act(() => plot().render());
    const { area } = plot().mainPane;
    act(() => plot().crosshair({ x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 }));
  };
  return { deps, ref, plot, overlay, hover };
}

const asVolume = (value: number, row: { label: string }) => (row.label === 'V' ? `${value / 100}h` : value.toFixed(0));

describe('<Tooltip formatRow> / <Legend formatRow>', () => {
  it('formats a described row through formatRow, and follows a changed formatter without reinstalling', () => {
    const { deps, ref, overlay, hover } = setup();
    const ui = (formatRow: (value: number, row: { label: string }) => string) => (
      <ChartContainer deps={deps} data={candles} plotRef={ref}>
        <ChartCandles name="SOXL" />
        <Tooltip formatRow={formatRow} />
      </ChartContainer>
    );
    const view = render(ui(asVolume));
    hover();
    const box = () => overlay().querySelector('[data-chart-tooltip]');
    expect(box()?.textContent).toContain('V 8h');
    const mounted = box();

    view.rerender(ui((value, row) => (row.label === 'V' ? 'vol' : value.toFixed(0))));
    hover();
    expect(box()?.textContent).toContain('V vol');
    // The same element — the plugin was reconfigured, not reinstalled.
    expect(box()).toBe(mounted);
  });

  it('legend takes it too', () => {
    const { deps, ref, overlay, plot } = setup();
    render(
      <ChartContainer deps={deps} data={candles} plotRef={ref}>
        <ChartCandles name="SOXL" />
        <Legend formatRow={asVolume} />
      </ChartContainer>,
    );
    act(() => plot().render());
    expect(overlay().querySelector('[data-chart-legend]')?.textContent ?? '').toContain('V 9.5h');
  });
});
