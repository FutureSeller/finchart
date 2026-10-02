/** The panes stack in JSX order — a pane inserted above others, or keyed panes reordered, land where the tree puts them. */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const series = { price: lineSeries(), rsi: lineSeries(), macd: lineSeries() };
type Name = keyof typeof series;
/** A pane is named by the series it holds — the empty one is the pane added outside the JSX. */
const NAMES: readonly Name[] = ['price', 'rsi', 'macd'];
const nameOf = new Map<unknown, Name>(NAMES.map((name) => [series[name], name]));

function mount(first: Name[]) {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = createRef<Plot>();
  const ui = (names: Name[]) => (
    <ChartContainer deps={deps} data={data} plotRef={ref}>
      {names.map((name) => (
        <ChartPane key={name}>
          <ChartSeries series={series[name]} />
        </ChartPane>
      ))}
    </ChartContainer>
  );
  const view = render(ui(first));
  const keys = () => ref.current?.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty');
  return { ref, keys, show: (names: Name[]) => act(() => view.rerender(ui(names))) };
}

it('puts a pane inserted above the others where the JSX puts it', () => {
  const { keys, show } = mount(['price', 'macd']);

  show(['price', 'rsi', 'macd']);

  expect(keys()).toEqual(['price', 'rsi', 'macd']);
});

it('follows keyed panes when the JSX reorders them', () => {
  const { keys, show } = mount(['price', 'rsi', 'macd']);

  show(['price', 'macd', 'rsi']);

  expect(keys()).toEqual(['price', 'macd', 'rsi']);
});

it('restacks once per commit, not once per sibling whose rank moved', () => {
  const { ref, keys, show } = mount(['price', 'rsi', 'macd']);
  let changes = 0;
  ref.current!.on('panesChange', () => changes++);

  // Each sibling's new rank arrives in its own effect; restacking on each
  // one moves the chart through a half-sorted order first.
  show(['macd', 'rsi', 'price']);

  expect(keys()).toEqual(['macd', 'rsi', 'price']);
  expect(changes).toBe(1);
});

it("keeps the user's own order across a re-render that moves nothing in the JSX", () => {
  const { ref, keys, show } = mount(['price', 'rsi', 'macd']);
  const plot = ref.current!;
  act(() => plot.setPaneOrder([...plot.panes].reverse()));

  show(['price', 'rsi', 'macd']);

  expect(keys()).toEqual(['macd', 'rsi', 'price']);
});

it('leaves a pane added through plotRef where it was put', () => {
  const { ref, keys, show } = mount(['price', 'rsi']);
  const plot = ref.current!;
  act(() => {
    const added = plot.addPane();
    plot.setPaneOrder([added, ...plot.panes.filter((pane) => pane !== added)]);
  });

  show(['price', 'rsi']);

  expect(keys()).toEqual(['empty', 'price', 'rsi']);
});
