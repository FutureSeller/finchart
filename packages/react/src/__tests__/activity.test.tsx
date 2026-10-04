/**
 * An effect replay rebuilds the chart — React's `<Activity>` hiding and
 * showing the tree is one. The children must land on the new chart, not
 * stay bound to the destroyed one.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import * as React from 'react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const price = lineSeries();
const indicator = lineSeries();

// Activity is a React 19 capability. Keep this lifecycle regression in the
// React 19 lane while the same test suite can exercise the React 18 peer floor.
const activity = Reflect.get(React, 'Activity') as
  | ComponentType<{ mode: 'visible' | 'hidden'; children: ReactNode }>
  | undefined;
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
