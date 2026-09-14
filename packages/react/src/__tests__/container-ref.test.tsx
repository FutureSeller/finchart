/**
 * `<ChartContainer containerRef>` hands out the element the chart was built
 * on — the one that takes the keyboard. A toolbar button takes focus on
 * click, and the keys that follow (Esc to cancel a drawing) only reach the
 * chart once focus goes back to that element.
 */
import type { InputEvent, OHLC, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartCandles, ChartContainer } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const candles: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 5, open: 105, high: 112, low: 101, close: 102 },
];

function setup() {
  const spy = layersSpy();
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createAxisLabels: () => ({ render: () => undefined, clear: () => undefined, destroy: () => undefined }),
  });
  return { deps };
}

describe('<ChartContainer containerRef>', () => {
  it('holds the element the chart was built on while mounted, and null after', () => {
    const { deps } = setup();
    const containerRef = createRef<HTMLDivElement>();
    const view = render(
      <ChartContainer deps={deps} data={candles} containerRef={containerRef} ariaLabel="chart">
        <ChartCandles />
      </ChartContainer>,
    );
    const built = view.container.querySelector('[aria-label="chart"]');
    expect(built).toBeInstanceOf(HTMLDivElement);
    expect(containerRef.current).toBe(built);
    // The keyboard lives there — the element pointer wiring made focusable.
    expect(containerRef.current?.tabIndex).toBe(0);

    view.unmount();
    expect(containerRef.current).toBeNull();
  });

  it('is set again after StrictMode replays the mount', () => {
    const { deps } = setup();
    const containerRef = createRef<HTMLDivElement>();
    const view = render(
      <StrictMode>
        <ChartContainer deps={deps} data={candles} containerRef={containerRef} ariaLabel="chart">
          <ChartCandles />
        </ChartContainer>
      </StrictMode>,
    );
    expect(containerRef.current).toBe(view.container.querySelector('[aria-label="chart"]'));
  });

  it('lets go of a replaced ref and fills the new one', () => {
    const { deps } = setup();
    const first = createRef<HTMLDivElement>();
    const second = createRef<HTMLDivElement>();
    const ui = (ref: { current: HTMLDivElement | null }) => (
      <ChartContainer deps={deps} data={candles} containerRef={ref} ariaLabel="chart">
        <ChartCandles />
      </ChartContainer>
    );
    const view = render(ui(first));
    const built = view.container.querySelector('[aria-label="chart"]');
    view.rerender(ui(second));
    expect(first.current).toBeNull();
    expect(second.current).toBe(built);
  });

  it('is already set when onPlot announces the chart, on mount and on a keyed remount', () => {
    const { deps } = setup();
    const containerRef = createRef<HTMLDivElement>();
    const seen: Array<boolean> = [];
    const onPlot = (plot: Plot | null) => {
      if (plot) seen.push(containerRef.current instanceof HTMLDivElement);
    };
    const ui = (key: string) => (
      <ChartContainer key={key} deps={deps} data={candles} containerRef={containerRef} onPlot={onPlot}>
        <ChartCandles />
      </ChartContainer>
    );
    const view = render(ui('a'));
    view.rerender(ui('b'));
    expect(seen).toEqual([true, true]);
  });

  it('stays null on the server', () => {
    const { deps } = setup();
    const containerRef = createRef<HTMLDivElement>();
    expect(() =>
      renderToString(
        <ChartContainer deps={deps} data={candles} containerRef={containerRef}>
          <ChartCandles />
        </ChartContainer>,
      ),
    ).not.toThrow();
    expect(containerRef.current).toBeNull();
  });

  it('gives a toolbar the way to hand the keyboard back — Esc reaches the chart only after focus returns', () => {
    const { deps } = setup();
    const containerRef = createRef<HTMLDivElement>();
    const plotRef = createRef<Plot>();
    const heard: string[] = [];
    const view = render(
      <>
        <button type="button">Trend</button>
        <ChartContainer deps={deps} data={candles} containerRef={containerRef} plotRef={plotRef}>
          <ChartCandles />
        </ChartContainer>
      </>,
    );
    act(() => {
      plotRef.current?.addInputConsumer({
        handle: (event: InputEvent) => {
          if (event.type === 'keydown') heard.push(event.key);
          return false;
        },
      });
    });
    const escape = () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    const button = view.getByRole('button', { name: 'Trend' });
    button.focus();
    escape();
    expect(heard).toEqual([]);

    containerRef.current?.focus();
    escape();
    expect(heard).toEqual(['Escape']);
  });
});
