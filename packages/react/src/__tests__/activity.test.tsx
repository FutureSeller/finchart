/**
 * An effect replay rebuilds the chart — React's `<Activity>` hiding and
 * showing the tree is one. The children must land on the new chart, not
 * stay bound to the destroyed one. A hidden plugin consumer keeps its
 * state while its effect is cleaned up, so its api must read `null` rather
 * than a disposed plugin.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import * as React from 'react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { usePlugin } from '../hooks';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const price = lineSeries();
const indicator = lineSeries();

type ActivityComponent = ComponentType<{ mode: 'visible' | 'hidden'; children: ReactNode }>;

// Activity is a React 19 capability. Keep this lifecycle regression in the
// React 19 lane while the same test suite can exercise the React 18 peer floor.
// React 18's types don't declare it, so it is read by name: on 19 it is the
// component, on 18 it is absent.
function isActivity(value: unknown): value is ActivityComponent {
  return value !== undefined && value !== null;
}
const found: unknown = Reflect.get(React, 'Activity');
const activity = isActivity(found) ? found : undefined;
const Activity = activity ?? (() => { throw new Error('Activity is unavailable'); });
const activityTest = activity ? it : it.skip;

activityTest('re-attaches every pane and series after Activity hides and shows the chart', () => {
  const spy = layersSpy();
  const deps = browserDeps({ createLayers: spy.createLayers });
  const ref = React.createRef<Plot>();
  const ui = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>
    </Activity>
  );
  const { rerender } = render(ui('visible'));
  const first = ref.current;

  act(() => rerender(ui('hidden')));
  act(() => rerender(ui('visible')));

  const plot = ref.current;
  expect(plot).not.toBeNull();
  expect(plot).not.toBe(first);
  expect(plot?.panes).toHaveLength(2);
  expect(plot?.panes.map((pane) => pane.probe(50).length)).toEqual([1, 1]);
});

activityTest('usePlugin nulls its api while Activity hides the consumer, so no render sees a disposed api', () => {
  const disposed = new Set<object>();
  const seen: Array<'null' | 'live' | 'disposed'> = [];

  function Consumer() {
    const api = usePlugin(() => {
      const installed = { dispose: () => void disposed.add(installed) };
      return installed;
    }, []);
    seen.push(api === null ? 'null' : disposed.has(api) ? 'disposed' : 'live');
    return null;
  }

  const ui = (mode: 'visible' | 'hidden') => (
    <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data}>
      <Activity mode={mode}>
        <Consumer />
      </Activity>
    </ChartContainer>
  );
  const { rerender } = render(ui('visible'));
  expect(seen.at(-1)).toBe('live');

  // Hiding runs the effect cleanup but keeps the component's state.
  act(() => rerender(ui('hidden')));
  expect(disposed.size).toBe(1);
  expect(seen.at(-1)).toBe('null');

  act(() => rerender(ui('visible')));
  expect(seen.at(-1)).toBe('live');
  expect(seen).not.toContain('disposed');
});
