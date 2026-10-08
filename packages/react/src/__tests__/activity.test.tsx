/**
 * An effect replay rebuilds the chart — React's `<Activity>` hiding and
 * showing the tree is one. The children must land on the new chart, not
 * stay bound to the destroyed one. A hidden plugin consumer keeps its
 * state while its effect is cleaned up, so its api must read `null` rather
 * than a disposed plugin.
 */
import type { LineDataPoint, Pane, PluginApi, Plot } from '@finchart/core';
import { lineSeries, LogScale } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import * as React from 'react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries, Plugin, useChartPlot } from '../components';
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

activityTest('hiding the chart announces no pane changes', () => {
  const heard: string[] = [];
  function Inside() {
    const plot = useChartPlot();
    React.useEffect(() => plot.on('panesChange', () => heard.push('inside')), [plot]);
    return null;
  }
  const onPlot = (plot: Plot | null) => {
    plot?.on('panesChange', () => heard.push('onPlot'));
  };
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ui = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <ChartContainer deps={deps} data={data} onPlot={onPlot}>
        <Inside />
        <ChartPane><ChartSeries series={price} /></ChartPane>
        <ChartPane><ChartSeries series={indicator} /></ChartPane>
        <ChartPane><ChartSeries series={lineSeries()} /></ChartPane>
      </ChartContainer>
    </Activity>
  );
  const { rerender } = render(ui('visible'));
  heard.length = 0;

  act(() => rerender(ui('hidden')));

  expect(heard).toEqual([]);
});

activityTest('a pane deleted while Activity hides the whole chart is not on the chart it shows again', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = React.createRef<Plot>();
  const ui = (mode: 'visible' | 'hidden', names: Array<'price' | 'indicator'>) => (
    <Activity mode={mode}>
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        {names.map((name) => (
          <ChartPane key={name} yScale={name === 'price' ? () => new LogScale() : undefined}>
            <ChartSeries series={name === 'price' ? price : indicator} />
          </ChartPane>
        ))}
      </ChartContainer>
    </Activity>
  );
  const { rerender } = render(ui('visible', ['price', 'indicator']));

  act(() => rerender(ui('hidden', ['price', 'indicator'])));
  act(() => rerender(ui('hidden', ['indicator'])));
  act(() => rerender(ui('visible', ['indicator'])));

  const plot = ref.current;
  expect(plot?.panes).toHaveLength(1);
  expect(plot?.mainPane.getSeries()).toEqual([indicator]);
  expect(plot?.mainPane.yScale.kind).toBe('linear');
});

/**
 * One pane hidden leaves the chart, and its children with it: a reveal hands
 * them the new pane, never the one that left — installing on that throws.
 */
activityTest('a pane Activity hides leaves the chart and comes back in place with its current props', () => {
  const ref = React.createRef<Plot>();
  const installedOn: Pane[] = [];
  const counted = (pane: Pane): PluginApi => {
    installedOn.push(pane);
    return { disposed: false, dispose() {} };
  };
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ui = (mode: 'visible' | 'hidden', flex: number) => (
    <ChartContainer deps={deps} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={price} /></ChartPane>
      <Activity mode={mode}>
        <ChartPane flex={flex}>
          <ChartSeries series={indicator} />
          <Plugin install={(_plot, pane) => pane.use(counted)} />
        </ChartPane>
      </Activity>
    </ChartContainer>
  );
  const { rerender } = render(ui('visible', 1));
  const plot = ref.current;
  if (!plot) throw new Error('plot is not mounted');
  const first = plot.panes[1];

  act(() => rerender(ui('hidden', 1)));
  expect(plot.panes).toEqual([plot.mainPane]);
  act(() => rerender(ui('hidden', 4)));
  act(() => rerender(ui('visible', 4)));

  expect(plot.panes).toHaveLength(2);
  const back = plot.panes[1];
  expect(back).not.toBe(first);
  expect(back.flex).toBe(4);
  expect(back.getSeries()).toEqual([indicator]);
  expect(installedOn.at(-1)).toBe(back);
  expect(installedOn.filter((pane) => pane !== first && pane !== back)).toEqual([]);
});

/**
 * Showing again rebuilds the chart; a wrapper still holding the old chart's
 * pane must not hand it to its children for that commit — installing on a
 * pane its chart's teardown detached throws.
 */
activityTest('hands the children of a pane only the rebuilt chart’s pane after Activity shows the chart', () => {
  const installedOn: Pane[] = [];
  const counted = (pane: Pane): PluginApi => {
    installedOn.push(pane);
    return { disposed: false, dispose() {} };
  };
  const ref = React.createRef<Plot>();
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ui = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane><ChartSeries series={price} /></ChartPane>
        <ChartPane>
          <ChartSeries series={indicator} />
          <Plugin install={(_plot, pane) => pane.use(counted)} />
        </ChartPane>
      </ChartContainer>
    </Activity>
  );
  const { rerender } = render(ui('visible'));

  act(() => rerender(ui('hidden')));
  act(() => rerender(ui('visible')));

  const plot = ref.current;
  expect(plot?.panes).toHaveLength(2);
  expect(installedOn.at(-1)).toBe(plot?.panes[1]);
});

activityTest('builds a pane that arrived while Activity hid the chart on the chart it shows again', () => {
  const ref = React.createRef<Plot>();
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ui = (mode: 'visible' | 'hidden', both: boolean) => (
    <Activity mode={mode}>
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane><ChartSeries series={price} /></ChartPane>
        {both && <ChartPane><ChartSeries series={indicator} /></ChartPane>}
      </ChartContainer>
    </Activity>
  );
  const { rerender } = render(ui('visible', false));

  act(() => rerender(ui('hidden', false)));
  act(() => rerender(ui('hidden', true)));
  act(() => rerender(ui('visible', true)));

  const plot = ref.current;
  expect(plot?.panes.map((pane) => pane.getSeries()[0])).toEqual([price, indicator]);
});

activityTest("keeps the user's own order when Activity hides a pane with one nested in it", () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = React.createRef<Plot>();
  const nested = lineSeries();
  const last = lineSeries();
  const label = new Map<unknown, string>([[price, 'a'], [indicator, 'b'], [nested, 'c'], [last, 'd']]);
  const ui = (mode: 'visible' | 'hidden') => (
    <ChartContainer deps={deps} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={price} /></ChartPane>
      <Activity mode={mode}>
        <ChartPane>
          <ChartSeries series={indicator} />
          <ChartPane><ChartSeries series={nested} /></ChartPane>
        </ChartPane>
      </Activity>
      <ChartPane><ChartSeries series={last} /></ChartPane>
    </ChartContainer>
  );
  const { rerender } = render(ui('visible'));
  const plot = ref.current;
  if (!plot) throw new Error('plot is not mounted');
  act(() => plot.setPaneOrder([...plot.panes].reverse()));

  act(() => rerender(ui('hidden')));

  expect(plot.panes.map((pane) => label.get(pane.getSeries()[0]))).toEqual(['d', 'a']);
});
