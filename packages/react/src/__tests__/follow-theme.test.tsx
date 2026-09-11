/**
 * `<ChartContainer followTheme>` wires `observeTheme` to `plot.requestRender()`.
 *
 * Renders are counted at the scheduler `deps` injects — not at the output,
 * because a destroyed plot draws nothing whether or not the observer is
 * still attached. So every "no redraw" case here runs against a **live**
 * plot: absent prop, prop turned off, and a filter that excludes the
 * attribute that changed.
 */
import type { LineDataPoint, Plot, SchedulerFactory } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 1 }];

function setup() {
  const spy = layersSpy();
  const counter = { requests: 0 };
  const createScheduler: SchedulerFactory = (render) => ({
    request: () => {
      counter.requests += 1;
      render();
    },
    cancel: () => undefined,
  });
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createScheduler,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
  const ref = createRef<Plot>();
  return { deps, ref, counter };
}

/** A MutationObserver delivers in a microtask; give it one turn. */
async function mutate(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Counts observers the theme watcher builds — for "same filter, no resubscribe". */
function countObservers() {
  const view = document.defaultView;
  if (!view) throw new Error('no window');
  const Real = view.MutationObserver;
  const count = { constructed: 0 };
  class Counting extends Real {
    constructor(callback: MutationCallback) {
      super(callback);
      count.constructed += 1;
    }
  }
  Object.defineProperty(view, 'MutationObserver', { value: Counting, configurable: true, writable: true });
  return {
    count,
    restore: () => Object.defineProperty(view, 'MutationObserver', { value: Real, configurable: true, writable: true }),
  };
}

describe('<ChartContainer followTheme>', () => {
  it('redraws once when a theme attribute changes on an ancestor', async () => {
    const { deps, ref, counter } = setup();
    render(<ChartContainer deps={deps} data={data} plotRef={ref} followTheme />);
    const before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(1);
    document.body.removeAttribute('data-theme');
  });

  it('does nothing when the prop is absent', async () => {
    const { deps, ref, counter } = setup();
    render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(0);
    document.body.removeAttribute('data-theme');
  });

  it('stops while the plot is alive when turned off, and starts again when turned on', async () => {
    const { deps, ref, counter } = setup();
    const ui = (on: boolean) => <ChartContainer deps={deps} data={data} plotRef={ref} followTheme={on} />;
    const view = render(ui(true));

    view.rerender(ui(false));
    let before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(0);

    view.rerender(ui(true));
    before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'light'));
    expect(counter.requests - before).toBe(1);
    document.body.removeAttribute('data-theme');
  });

  it('honours a custom attribute filter — it replaces the default one', async () => {
    const { deps, ref, counter } = setup();
    render(<ChartContainer deps={deps} data={data} plotRef={ref} followTheme={{ attributes: ['data-theme'] }} />);
    let before = counter.requests;
    await mutate(() => document.body.classList.add('light'));
    expect(counter.requests - before).toBe(0);

    before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(1);
    document.body.classList.remove('light');
    document.body.removeAttribute('data-theme');
  });

  it('does not resubscribe for an inline filter with the same value, and does for a different one', () => {
    const { deps, ref } = setup();
    const observers = countObservers();
    try {
      const view = render(
        <ChartContainer deps={deps} data={data} plotRef={ref} followTheme={{ attributes: ['data-theme'] }} />,
      );
      const after = observers.count.constructed;
      expect(after).toBeGreaterThan(0);

      view.rerender(
        <ChartContainer deps={deps} data={data} plotRef={ref} followTheme={{ attributes: ['data-theme'] }} />,
      );
      expect(observers.count.constructed).toBe(after);

      view.rerender(
        <ChartContainer deps={deps} data={data} plotRef={ref} followTheme={{ attributes: ['class'] }} />,
      );
      expect(observers.count.constructed).toBe(after + 1);
    } finally {
      observers.restore();
    }
  });

  it('watches the new filter after a change, not the old one', async () => {
    const { deps, ref, counter } = setup();
    const ui = (attributes: string[]) => (
      <ChartContainer deps={deps} data={data} plotRef={ref} followTheme={{ attributes }} />
    );
    const view = render(ui(['data-theme']));
    view.rerender(ui(['class']));

    let before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(0);

    before = counter.requests;
    await mutate(() => document.body.classList.add('light'));
    expect(counter.requests - before).toBe(1);
    document.body.classList.remove('light');
    document.body.removeAttribute('data-theme');
  });

  it('survives StrictMode — exactly one live subscription after the replay', async () => {
    const { deps, ref, counter } = setup();
    render(
      <StrictMode>
        <ChartContainer deps={deps} data={data} plotRef={ref} followTheme />
      </StrictMode>,
    );
    const before = counter.requests;
    await mutate(() => document.body.setAttribute('data-theme', 'dark'));
    expect(counter.requests - before).toBe(1);
    document.body.removeAttribute('data-theme');
  });
});
