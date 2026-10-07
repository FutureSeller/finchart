/** The panes stack in JSX order — a pane inserted above others, or keyed panes reordered, land where the tree puts them. */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactElement, useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

function current(ref: { current: Plot | null }): Plot {
  if (!ref.current) throw new Error('plot is not mounted');
  return ref.current;
}

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

it('stacks a pane above the pane nested in it once a JSX move restacks', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = createRef<Plot>();
  const ui = (inserted: boolean) => (
    <ChartContainer deps={deps} data={data} plotRef={ref}>
      <ChartPane key="price">
        <ChartSeries series={series.price} />
        <ChartPane key="rsi">
          <ChartSeries series={series.rsi} />
        </ChartPane>
      </ChartPane>
      {inserted && <ChartPane key="empty" />}
      <ChartPane key="macd">
        <ChartSeries series={series.macd} />
      </ChartPane>
    </ChartContainer>
  );
  const view = render(ui(false));
  const plot = ref.current;
  if (!plot) throw new Error('plot is not mounted');
  const keys = () => plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty');
  expect(keys()).toEqual(['price', 'rsi', 'macd']);
  act(() => plot.setPaneOrder([...plot.panes].reverse()));

  // A pane mounting restacks, so the stack is sorted by JSX path again.
  act(() => view.rerender(ui(true)));

  expect(keys()).toEqual(['price', 'rsi', 'empty', 'macd']);
});

/**
 * A series outside every pane is counted among the same JSX positions as
 * the panes, so one appearing between them renumbers the panes below it
 * without moving any pane past another.
 */
describe("a series appearing among the panes keeps the user's own order", () => {
  const late = lineSeries();
  const tree = (ref: { current: Plot | null }, middle: ReactElement | false) => (
    <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={series.price} /></ChartPane>
      <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
      {middle}
      <ChartPane><ChartSeries series={series.macd} /></ChartPane>
    </ChartContainer>
  );
  const keys = (plot: Plot) => plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]));

  it('when its own component switches it on', () => {
    const ref = createRef<Plot>();
    let turnOn = () => {};
    function Late() {
      const [on, setOn] = useState(false);
      turnOn = () => setOn(true);
      return on ? <ChartSeries series={late} /> : null;
    }
    render(tree(ref, <Late />));
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    act(() => turnOn());

    expect(keys(plot)).toEqual(['macd', 'rsi', 'price']);
    expect(plot.mainPane.getSeries()).toEqual([series.price, late]);
  });

  it('when the container switches it on', () => {
    const ref = createRef<Plot>();
    const view = render(tree(ref, false));
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    act(() => view.rerender(tree(ref, <ChartSeries series={late} />)));

    expect(keys(plot)).toEqual(['macd', 'rsi', 'price']);
    expect(plot.mainPane.getSeries()).toEqual([series.price, late]);
  });
});

it('puts a pane switched on by its own component where the JSX puts it', () => {
  const ref = createRef<Plot>();
  let turnOn = () => {};
  function Late() {
    const [on, setOn] = useState(false);
    turnOn = () => setOn(true);
    return on ? <ChartPane><ChartSeries series={series.rsi} /></ChartPane> : null;
  }
  render(
    <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={series.price} /></ChartPane>
      <Late />
      <ChartPane><ChartSeries series={series.macd} /></ChartPane>
    </ChartContainer>,
  );

  act(() => turnOn());

  expect(ref.current?.panes.map((pane) => nameOf.get(pane.getSeries()[0]))).toEqual(['price', 'rsi', 'macd']);
});

/**
 * The corrective pass has to land in the same task as the mount — a frame
 * drawn in between would show the pane last. `flushSync` outside `act`
 * returns once React stops working synchronously, as it does before the
 * browser gets a frame.
 */
it('has a pane switched on by its own component in place by the time the update returns', () => {
  const ref = createRef<Plot>();
  let turnOn = () => {};
  function Late() {
    const [on, setOn] = useState(false);
    turnOn = () => setOn(true);
    return on ? <ChartPane><ChartSeries series={series.rsi} /></ChartPane> : null;
  }
  render(
    <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={series.price} /></ChartPane>
      <Late />
      <ChartPane><ChartSeries series={series.macd} /></ChartPane>
    </ChartContainer>,
  );
  const plot = current(ref);

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
  let panes: (Name | undefined)[];
  try {
    flushSync(() => turnOn());
    panes = plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]));
  } finally {
    vi.unstubAllGlobals();
  }

  expect(panes).toEqual(['price', 'rsi', 'macd']);
});

it('follows keyed panes that reorder in the same commit one of them goes', () => {
  const { keys, show } = mount(['price', 'rsi', 'macd']);

  show(['macd', 'price']);

  expect(keys()).toEqual(['macd', 'price']);
});

/** A pane going moves no other pane past another, so the user's later order holds. */
describe("a pane switched off by its own component keeps the user's later order", () => {
  function setup() {
    const ref = createRef<Plot>();
    let turnOff = () => {};
    let grow = () => {};
    function Toggle() {
      const [on, setOn] = useState(true);
      turnOff = () => setOn(false);
      return on ? <ChartPane><ChartSeries series={series.rsi} /></ChartPane> : null;
    }
    function Last() {
      const [flex, setFlex] = useState(1);
      grow = () => setFlex((value) => value + 1);
      return <ChartPane flex={flex}><ChartSeries series={series.macd} /></ChartPane>;
    }
    const tree = (points: LineDataPoint[]) => (
      <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={points} plotRef={ref}>
        <ChartPane><ChartSeries series={series.price} /></ChartPane>
        <Toggle />
        <Last />
      </ChartContainer>
    );
    const view = render(tree(data));
    const plot = current(ref);
    act(() => turnOff());
    act(() => plot.setPaneOrder([...plot.panes].reverse()));
    const keys = () => plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]));
    return { keys, grow: () => act(() => grow()), rerender: () => act(() => view.rerender(tree([...data]))) };
  }

  it('when a pane below re-renders on its own', () => {
    const { keys, grow } = setup();

    grow();

    expect(keys()).toEqual(['macd', 'price']);
  });

  it('when the container re-renders', () => {
    const { keys, rerender } = setup();

    rerender();

    expect(keys()).toEqual(['macd', 'price']);
  });
});

/** The main pane outlives its `<ChartPane>`; giving it up must not leave its JSX place behind. */
describe('the main pane after its ChartPane goes', () => {
  it('stays on top, empty, while the remaining panes reorder', () => {
    const { keys, show } = mount(['price', 'rsi', 'macd']);
    show(['rsi', 'price', 'macd']);
    show(['rsi', 'macd']);

    show(['macd', 'rsi']);

    expect(keys()).toEqual(['empty', 'macd', 'rsi']);
  });

  it('takes its JSX place again when a ChartPane claims it back', () => {
    const ref = createRef<Plot>();
    let toggle = (_on: boolean) => {};
    function First() {
      const [on, setOn] = useState(true);
      toggle = setOn;
      return on ? <ChartPane><ChartSeries series={series.price} /></ChartPane> : null;
    }
    render(
      <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
        <First />
        <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
      </ChartContainer>,
    );
    const plot = current(ref);
    act(() => toggle(false));
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    act(() => toggle(true));

    expect(plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]))).toEqual(['price', 'rsi']);
  });
});
