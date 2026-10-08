/** The panes stack in JSX order — a pane inserted above others, or keyed panes reordered, land where the tree puts them. */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries, LogScale } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactElement, startTransition, Suspense, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries, useChartPlot } from '../components';
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

it('keeps a pane added through plotRef below the declared panes when a pane mounting restacks', () => {
  const { ref, keys, show } = mount(['price', 'macd']);
  act(() => void current(ref).addPane());

  show(['price', 'rsi', 'macd']);

  expect(keys()).toEqual(['price', 'rsi', 'macd', 'empty']);
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
 * A frame can be drawn between any two tasks, so a mounting pane has to be
 * filled and in place before React hands the task back. `flushSync` outside
 * `act` returns once React stops working synchronously — what is on the chart
 * then is what the next frame would draw.
 */
describe('a pane mounted in a sync update is in place by the time the update returns', () => {
  function outsideAct(update: () => void) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    try {
      flushSync(update);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('when its own component switches it on', () => {
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

    outsideAct(() => turnOn());

    expect(plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]))).toEqual(['price', 'rsi', 'macd']);
  });

  it('when the container inserts it', () => {
    const ref = createRef<Plot>();
    let show = (_names: Name[]) => {};
    function Host() {
      const [names, setNames] = useState<Name[]>(['price', 'macd']);
      show = setNames;
      return (
        <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
          {names.map((name) => (
            <ChartPane key={name}><ChartSeries series={series[name]} /></ChartPane>
          ))}
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);

    outsideAct(() => show(['price', 'rsi', 'macd']));

    expect(plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]))).toEqual(['price', 'rsi', 'macd']);
  });
});

/**
 * An update React schedules renders in tasks of its own, so the chart is
 * sampled between tasks — where a frame could be drawn — until the pane has
 * arrived. Every sample shows the stack before the update or after it.
 * These catch a pane built, filled or placed after paint, on React 18 and 19.
 */
describe('a pane the container inserts in a scheduled update is in place at every task boundary', () => {
  async function samples(update: (show: (names: Name[]) => void) => void) {
    const ref = createRef<Plot>();
    let show = (_names: Name[]) => {};
    function Host() {
      const [names, setNames] = useState<Name[]>(['price', 'macd']);
      show = setNames;
      return (
        <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
          {names.map((name) => (
            <ChartPane key={name}><ChartSeries series={series[name]} /></ChartPane>
          ))}
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);
    const seen: string[] = [];
    const sample = () => {
      const stack = plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty').join(' ');
      if (seen.at(-1) !== stack) seen.push(stack);
    };
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    try {
      // React schedules its own tasks with `setImmediate` here, so sampling
      // on the same queue lands between each of them.
      setImmediate(() => update(show));
      // Until the pane has been seen in place for a few tasks — a slow runner
      // takes more tasks to get there; the bound only keeps a stuck update
      // from hanging the test.
      let settled = 0;
      for (let task = 0; task < 500 && settled < 5; task++) {
        await new Promise((resolve) => setImmediate(resolve));
        sample();
        if (seen.at(-1) === 'price rsi macd') settled += 1;
      }
    } finally {
      vi.unstubAllGlobals();
    }
    return seen;
  }

  it('at default priority', async () => {
    const seen = await samples((show) => show(['price', 'rsi', 'macd']));

    expect(seen).toEqual(['price macd', 'price rsi macd']);
  });

  it('in a transition', async () => {
    const seen = await samples((show) => startTransition(() => show(['price', 'rsi', 'macd'])));

    expect(seen).toEqual(['price macd', 'price rsi macd']);
  });
});

/**
 * The chart's last breath is not a change the user made: a listener inside
 * the tree, or one a parent attached through `onPlot`, would get a setState
 * landing on a tree mid-unmount, with nothing to trace it to.
 */
describe('the whole chart going announces no pane changes', () => {
  function setup() {
    /** Who heard a `panesChange`, from which chart. */
    const heard: Array<[string, Plot]> = [];
    function Inside() {
      const plot = useChartPlot();
      useEffect(() => plot.on('panesChange', () => heard.push(['inside', plot])), [plot]);
      return null;
    }
    const onPlot = (plot: Plot | null) => {
      plot?.on('panesChange', () => heard.push(['onPlot', plot]));
    };
    const ref = createRef<Plot>();
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const tree = (key: string) => (
      <ChartContainer key={key} deps={deps} data={data} plotRef={ref} onPlot={onPlot}>
        <Inside />
        {/* Its scale replaces the main pane's, which a release puts back. */}
        <ChartPane yScale={() => new LogScale()}><ChartSeries series={series.price} /></ChartPane>
        <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
        <ChartPane><ChartSeries series={series.macd} /></ChartPane>
      </ChartContainer>
    );
    const view = render(tree('a'));
    const first = current(ref);
    heard.length = 0;
    const heardFromFirst = () => heard.filter(([, plot]) => plot === first).map(([who]) => who);
    return { heardFromFirst, view, tree };
  }

  it('when the container unmounts', () => {
    const { heardFromFirst, view } = setup();

    view.unmount();

    expect(heardFromFirst()).toEqual([]);
  });

  it('when a new key remounts the container', () => {
    const { heardFromFirst, view, tree } = setup();

    // The new chart's own mount may ring; the old one going may not.
    act(() => view.rerender(tree('b')));

    expect(heardFromFirst()).toEqual([]);
  });
});

/**
 * A boundary that already shows the chart hides it again when something in
 * it suspends outside a transition. Its layout effects are cleaned up and
 * set up again on reveal, but the chart is not torn down, so it has to come
 * back as it was — no pane added twice, the main pane's own scale still
 * there for when its wrapper goes.
 */
it('comes back as it was after a Suspense boundary hides and shows it', async () => {
  const ref = createRef<Plot>();
  let resolve = () => {};
  let done = false;
  const pending = new Promise<void>((settle) => {
    resolve = () => {
      done = true;
      settle();
    };
  });
  let suspend = () => {};
  function Gate() {
    const [on, setOn] = useState(false);
    suspend = () => setOn(true);
    if (on && !done) throw pending;
    return null;
  }
  let dropFirst = () => {};
  function First() {
    const [on, setOn] = useState(true);
    dropFirst = () => setOn(false);
    return on ? <ChartPane yScale={() => new LogScale()}><ChartSeries series={series.price} /></ChartPane> : null;
  }
  render(
    <Suspense fallback={null}>
      <Gate />
      <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
        <First />
        <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
        <ChartPane><ChartSeries series={series.macd} /></ChartPane>
      </ChartContainer>
    </Suspense>,
  );
  const plot = current(ref);

  act(() => suspend());
  await act(async () => {
    resolve();
    await pending;
  });

  expect(plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty')).toEqual(['price', 'rsi', 'macd']);
  act(() => dropFirst());
  expect(plot.mainPane.yScale.kind).toBe('linear');
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

it("keeps the user's own order when the container drops a pane", () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = createRef<Plot>();
  const four = { a: series.price, b: series.rsi, c: series.macd, d: lineSeries() };
  type Key = keyof typeof four;
  const label = new Map<unknown, Key>([[four.a, 'a'], [four.b, 'b'], [four.c, 'c'], [four.d, 'd']]);
  const ui = (keys: Key[]) => (
    <ChartContainer deps={deps} data={data} plotRef={ref}>
      {keys.map((key) => <ChartPane key={key}><ChartSeries series={four[key]} /></ChartPane>)}
    </ChartContainer>
  );
  const view = render(ui(['a', 'b', 'c', 'd']));
  const plot = current(ref);
  const [a, b, c, d] = plot.panes;
  act(() => plot.setPaneOrder([a, d, c, b]));

  act(() => view.rerender(ui(['a', 'b', 'd'])));

  expect(plot.panes.map((pane) => label.get(pane.getSeries()[0]))).toEqual(['a', 'd', 'b']);
});

/**
 * A wrapper on its way out is only released by its passive cleanup, so the
 * settle of the commit it leaves in still sees it — with the rank it last
 * declared, while the panes left were ranked afresh around it. It must not
 * read as a pane moving past another.
 */
describe("keeps the user's own order when a pane goes", () => {
  it('after a pane was inserted before it', () => {
    const { ref, keys, show } = mount(['price', 'macd']);
    show(['price', 'rsi', 'macd']);
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    show(['price', 'macd']);

    expect(keys()).toEqual(['macd', 'price']);
  });

  it('with a pane nested in it', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const ref = createRef<Plot>();
    const fourth = lineSeries();
    const label = new Map<unknown, string>([[series.price, 'a'], [series.rsi, 'b'], [series.macd, 'c'], [fourth, 'd']]);
    const ui = (middle: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane><ChartSeries series={series.price} /></ChartPane>
        {middle && (
          <ChartPane>
            <ChartSeries series={series.rsi} />
            <ChartPane><ChartSeries series={series.macd} /></ChartPane>
          </ChartPane>
        )}
        <ChartPane><ChartSeries series={fourth} /></ChartPane>
      </ChartContainer>
    );
    const view = render(ui(true));
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    act(() => view.rerender(ui(false)));

    expect(plot.panes.map((pane) => label.get(pane.getSeries()[0]))).toEqual(['d', 'a']);
  });

  it('after a Suspense boundary hid and showed another', async () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const ref = createRef<Plot>();
    let resolve = () => {};
    let done = false;
    const pending = new Promise<void>((settle) => {
      resolve = () => {
        done = true;
        settle();
      };
    });
    let suspend = () => {};
    function Gate() {
      const [on, setOn] = useState(false);
      suspend = () => setOn(true);
      if (on && !done) throw pending;
      return null;
    }
    const ui = (last: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane><ChartSeries series={series.price} /></ChartPane>
        <Suspense fallback={null}>
          <Gate />
          <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
        </Suspense>
        {last && <ChartPane><ChartSeries series={series.macd} /></ChartPane>}
      </ChartContainer>
    );
    const view = render(ui(true));
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));
    act(() => suspend());
    await act(async () => {
      resolve();
      await pending;
    });

    act(() => view.rerender(ui(false)));

    expect(plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]))).toEqual(['rsi', 'price']);
  });
});

/**
 * A pane switched off comes off in the same flush its series do — before
 * React hands the task back, for a sync update like a click — never left on
 * the chart empty for a frame.
 */
it('takes a pane switched off in a sync update off before the update returns', async () => {
  const ref = createRef<Plot>();
  let off = () => {};
  function Toggle() {
    const [on, setOn] = useState(true);
    off = () => setOn(false);
    return on ? <ChartPane><ChartSeries series={series.rsi} /></ChartPane> : null;
  }
  render(
    <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={data} plotRef={ref}>
      <ChartPane><ChartSeries series={series.price} /></ChartPane>
      <Toggle />
      <ChartPane><ChartSeries series={series.macd} /></ChartPane>
    </ChartContainer>,
  );
  const plot = current(ref);
  const stack = () => plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty').join(' ');
  const seen: string[] = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
  try {
    setImmediate(() => {
      flushSync(() => off());
      seen.push(`returned: ${stack()}`);
    });
    // Until the pane has been seen gone for a few tasks; the bound only keeps
    // a stuck update from hanging the test.
    let settled = 0;
    for (let task = 0; task < 500 && settled < 5; task++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (seen.at(-1) !== stack()) seen.push(stack());
      if (stack() === 'price macd') settled += 1;
    }
  } finally {
    vi.unstubAllGlobals();
  }

  expect(seen).toEqual(['returned: price macd', 'price macd']);
});
