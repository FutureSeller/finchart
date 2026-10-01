/**
 * Measures two promises that arise from `<ChartSeries>` routing through
 * `pane.syncSeries`.
 *
 * 1. **Draw order is JSX order.** An indicator that gets conditionally
 *    turned on later doesn't jump to the top — effect registration order
 *    can't tell us the answer, so ordering is collected at the render
 *    phase.
 * 2. **It's fine to build a new series object on every render.** As long as
 *    it stays in the same slot, it's the same series, so an unchanged
 *    deriveKey means the derive doesn't rerun. This is the basis for not
 *    requiring `useMemo`.
 */
import type { DataView, LineDataPoint, Plot, PlotDeps, Series } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import {
  createRef,
  type ReactElement,
  StrictMode,
  Suspense,
  startTransition,
  useState,
} from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartData, ChartLine, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A series that logs its draw order. A function so we can check that rebuilding it every render is fine. */
function fakeSeries(name: string, log: string[]): Series<LineDataPoint> {
  return {
    valueExtent: () => ({ min: 0, max: 30 }),
    draw: () => log.push(name),
  };
}

/** A derive that counts how many times it ran. */
function countingDerive(calls: { n: number }) {
  return (source: DataView<LineDataPoint>): LineDataPoint[] => {
    calls.n += 1;
    return source.map((point) => ({
      x: point.x,
      y: point.y === null ? null : point.y * 2,
    }));
  };
}

function setup() {
  const spy = layersSpy();
  // Feed the recipe an inspectable div to get the finished wiring.
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  })(document.createElement("div"));
  const ref = createRef<Plot>();

  const plot = () => {
    if (!ref.current) throw new Error('plot is not mounted');
    return ref.current;
  };

  return { deps, ref, plot };
}

/** Draws exactly once from the current state and reads off the order. */
function drawOrder(plot: Plot, log: string[]): string[] {
  log.length = 0;
  act(() => plot.render());
  return log;
}

const mount = (ui: ReactElement) => render(ui);

describe('<ChartSeries> order', () => {
  it('should make React-declared series reject a later imperative insertion', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={fakeSeries('declared', log)} />
      </ChartContainer>,
    );

    expect(() => plot().mainPane.addSeries({ series: fakeSeries('imperative', log), data })).toThrow(
      /owned by syncSeries/,
    );
    expect(drawOrder(plot(), log)).toEqual(['declared']);
  });

  it('should draw siblings in JSX order', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={fakeSeries('a', log)} />
        <ChartSeries series={fakeSeries('b', log)} />
      </ChartContainer>,
    );

    expect(drawOrder(plot(), log)).toEqual(['a', 'b']);
  });

  /**
   * The scenario of toggling an indicator on and off. Since addSeries is a
   * push, b would always end up on top.
   */
  it('should place a conditionally mounted series where JSX puts it', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    const view = (withB: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={fakeSeries('a', log)} />
        {withB && <ChartSeries series={fakeSeries('b', log)} />}
        <ChartSeries series={fakeSeries('c', log)} />
      </ChartContainer>
    );

    const mounted = mount(view(false));
    expect(drawOrder(plot(), log)).toEqual(['a', 'c']);

    mounted.rerender(view(true));

    expect(drawOrder(plot(), log)).toEqual(['a', 'b', 'c']);
  });

  it('should drop a series that unmounted', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    const view = (withB: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={fakeSeries('a', log)} />
        {withB && <ChartSeries series={fakeSeries('b', log)} />}
      </ChartContainer>
    );

    const mounted = mount(view(true));
    mounted.rerender(view(false));

    expect(drawOrder(plot(), log)).toEqual(['a']);
  });

  it('should order each pane on its own', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={3}>
          <ChartSeries series={fakeSeries('price', log)} />
          <ChartSeries series={fakeSeries('ma', log)} />
        </ChartPane>
        <ChartPane flex={1}>
          <ChartSeries series={fakeSeries('mom', log)} />
        </ChartPane>
      </ChartContainer>,
    );

    expect(drawOrder(plot(), log)).toEqual(['price', 'ma', 'mom']);
  });

  /**
   * When rendering from a list, `key` is what carries identity — reordering
   * carries the draw order along with it, and since the instance stays the
   * same, the derive cache underneath comes along too.
   */
  it('should follow the key when a list reorders', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    const view = (names: string[]) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        {names.map((name) => (
          <ChartSeries key={name} series={fakeSeries(name, log)} />
        ))}
      </ChartContainer>
    );

    const mounted = mount(view(['a', 'b']));
    expect(drawOrder(plot(), log)).toEqual(['a', 'b']);

    mounted.rerender(view(['b', 'a']));

    expect(drawOrder(plot(), log)).toEqual(['b', 'a']);
  });

  /**
   * Since placement happens at the render phase, StrictMode is the test bed
   * — both render and effects run twice, and order must not waver.
   */
  it('should survive StrictMode', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    const view = (withB: boolean) => (
      <StrictMode>
        <ChartContainer deps={deps} data={data} plotRef={ref}>
          <ChartSeries series={fakeSeries('a', log)} />
          {withB && <ChartSeries series={fakeSeries('b', log)} />}
          <ChartSeries series={fakeSeries('c', log)} />
        </ChartContainer>
      </StrictMode>
    );

    const mounted = mount(view(false));
    expect(drawOrder(plot(), log)).toEqual(['a', 'c']);

    mounted.rerender(view(true));

    expect(drawOrder(plot(), log)).toEqual(['a', 'b', 'c']);
  });

  /**
   * Identity is the component instance. Even putting the same series object
   * in two slots gives two entries, since there's two slots — with no
   * human-assigned id, there's nothing for them to collide on.
   */
  it('should treat two elements holding the same series as two series', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    const shared = fakeSeries('shared', log);

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={shared} />
        <ChartSeries series={shared} />
      </ChartContainer>,
    );

    expect(drawOrder(plot(), log)).toEqual(['shared', 'shared']);
  });
});

/**
 * This is the regression barrier — since the derive cache lives inside the
 * Entry closure, if React swaps out the registration on every render, the
 * whole cache gets wiped.
 */
describe('<ChartSeries> derive cache', () => {
  it('should not recompute when the series object is new but the slot and deriveKey are not', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    const calls = { n: 0 };
    const derive = countingDerive(calls);

    const view = () => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        {/* A new series on every render. No useMemo. */}
        <ChartSeries
          series={fakeSeries(`ma-${calls.n}`, log)}
          derive={derive}
          deriveKey={[20]}
        />
      </ChartContainer>
    );

    const mounted = mount(view());
    act(() => plot().render());
    expect(calls.n).toBe(1);

    mounted.rerender(view());
    act(() => plot().render());

    expect(calls.n).toBe(1);
  });

  it('should draw the newest series object after a re-render', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    const derive = (source: DataView<LineDataPoint>) => [...source];

    const view = (name: string) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries
          series={fakeSeries(name, log)}
          derive={derive}
          deriveKey={[20]}
        />
      </ChartContainer>
    );

    const mounted = mount(view('old'));
    mounted.rerender(view('new'));

    expect(drawOrder(plot(), log)).toEqual(['new']);
  });

  /**
   * The case where neither the pane nor the container re-renders, and
   * **only the component in between** re-renders. Placement finishes at
   * render, but handing off to the stage happens at commit, so the only one
   * left to flush it at that point is `<ChartSeries>` itself.
   */
  it('should swap the series when only an intermediate component re-renders', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    let swap: (name: string) => void = () => undefined;

    function Indicator() {
      const [name, setName] = useState('old');
      swap = setName;

      return <ChartSeries series={fakeSeries(name, log)} />;
    }

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <Indicator />
        </ChartPane>
      </ChartContainer>,
    );

    expect(drawOrder(plot(), log)).toEqual(['old']);

    act(() => swap('new'));

    expect(drawOrder(plot(), log)).toEqual(['new']);
  });

  it('should recompute when deriveKey changes', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];
    const calls = { n: 0 };
    const derive = countingDerive(calls);

    const view = (period: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries
          series={fakeSeries('ma', log)}
          derive={derive}
          deriveKey={[period]}
        />
      </ChartContainer>
    );

    const mounted = mount(view(20));
    act(() => plot().render());
    mounted.rerender(view(50));
    act(() => plot().render());

    expect(calls.n).toBe(2);
  });
});

/**
 * Data travels through the prop down to the series.
 *
 * `data` is a prop contract, not a core API call. This contract is
 * unchanged even after `setData` disappeared from the stage — what changed
 * is only the wiring that the container **hands it down to its children**.
 */
describe('<ChartContainer data>', () => {
  const view = (deps: PlotDeps, points: LineDataPoint[], ref: ReturnType<typeof createRef<Plot>>) => (
    <ChartContainer deps={deps} data={points} plotRef={ref}>
      <ChartSeries series={fakeSeries('price', [])} />
    </ChartContainer>
  );

  it('should fit the first data that arrives', () => {
    const { deps, ref, plot } = setup();

    mount(view(deps, data, ref));

    expect(plot().getState().xDomain).toEqual({ min: 0, max: 100 });
    expect(plot().mainPane.xRange()).toEqual({ min: 0, max: 100 });
  });

  /**
   * **This is infinite scroll.** Passing a new array with history prepended
   * still leaves the viewport where it was, so the example app appends
   * history with nothing more than `setState` — no imperative door like
   * `prependData` is needed.
   */
  it('should keep the viewport when older data is prepended', () => {
    const { deps, ref, plot } = setup();
    const mounted = mount(view(deps, data, ref));

    act(() => plot().pan(-20));
    const viewing = plot().getState().xDomain;

    mounted.rerender(view(deps, [{ x: -50, y: 5 }, ...data], ref));

    expect(plot().getState().xDomain).toEqual(viewing);
    // The new point is still on the stage, though.
    expect(plot().mainPane.xRange()).toEqual({ min: -50, max: 100 });
  });
});

/**
 * Data can differ per series.
 *
 * The container's `data` is the **default** for the whole stage, and a
 * series can declare its own. Back when a chart only ever had one data set,
 * this shape didn't exist at all.
 */
describe('<ChartData> · <ChartSeries data>', () => {
  // x 0..10 in 200 steps — enough bars to fill the screen at the default
  // spacing, so the first fit settles; a shorter first history keeps fitting
  // as data arrives, until it fills.
  const btc: LineDataPoint[] = Array.from({ length: 201 }, (_, i) => ({ x: i / 20, y: 40 + i / 100 }));
  const eth: LineDataPoint[] = [
    { x: 100, y: 2 },
    { x: 110, y: 3 },
  ];

  it('should let a series bring its own data', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={btc} plotRef={ref}>
        <ChartSeries series={fakeSeries('btc', [])} />
        <ChartSeries series={fakeSeries('eth', [])} data={eth} />
      </ChartContainer>,
    );

    // The stage's x is the union of both — both series are on the stage.
    expect(plot().mainPane.xRange()).toEqual({ min: 0, max: 110 });

    /**
     * The viewport stays fitted to **whichever arrived first**.
     *
     * Each series lands on the stage from its own effect, so "the first
     * data to arrive" is the first series. If ETH arriving later dragged
     * the viewport to the union, infinite scroll would break — the update
     * rule applies unchanged here. Call `fitDomains()` to see everything.
     */
    expect(plot().getState().xDomain).toEqual({ min: 0, max: 10 });
    act(() => plot().fitDomains());
    expect(plot().getState().xDomain).toEqual({ min: 0, max: 110 });
  });

  it('should hand a subtree its own source', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={btc} plotRef={ref}>
        <ChartSeries series={fakeSeries('btc', [])} />
        <ChartData value={eth}>
          <ChartSeries series={fakeSeries('eth-1', [])} />
          <ChartSeries series={fakeSeries('eth-2', [])} />
        </ChartData>
      </ChartContainer>,
    );

    expect(plot().mainPane.xRange()).toEqual({ min: 0, max: 110 });
    expect(plot().getState().xDomain).toEqual({ min: 0, max: 10 });
  });
});

/** Never resolves — below this, rendering happens but **the commit never comes.** */
function NeverResolves(): ReactElement {
  throw new Promise<void>(() => undefined);
}

/**
 * **A render does not guarantee a commit.**
 *
 * A child inside a suspended boundary gets rendered but its effects never
 * run. Placement (`place`) happens at the render phase, so if adding to the
 * list happened there too, **a series that never mounted would end up on
 * the stage.**
 *
 * That's why adding to the list is done by an effect.
 *
 * Built with `<Suspense>` — it's the only thing that can reproduce
 * "rendered but not committed" even under React 18.
 */
describe('an uncommitted render', () => {
  it('should not stage a series that never mounted', () => {
    const { deps, ref, plot } = setup();
    const log: string[] = [];

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={fakeSeries('visible', log)} />
        {/* Inside the boundary: `hidden` renders, but its sibling suspends so the commit never comes. */}
        <Suspense fallback={null}>
          <ChartSeries series={fakeSeries('hidden', log)} />
          <NeverResolves />
        </Suspense>
      </ChartContainer>,
    );

    expect(drawOrder(plot(), log)).toEqual(['visible']);
  });
});

it('does not publish a suspended series candidate when a sibling commits', async () => {
  const { deps, ref, plot } = setup();
  const log: string[] = [];
  const never = new Promise<void>(() => {});
  let updateA = (_n: number) => {};
  let updateB = (_n: number) => {};
  function Suspend({ active }: { active: boolean }) {
    if (active) throw never;
    return null;
  }
  function A() {
    const [n, set] = useState(0);
    updateA = set;
    return <><ChartSeries series={fakeSeries(`A${n}`, log)} /><Suspend active={n > 0} /></>;
  }
  function B() {
    const [n, set] = useState(0);
    updateB = set;
    return <ChartSeries series={fakeSeries(`B${n}`, log)} />;
  }
  mount(<ChartContainer deps={deps} data={data} plotRef={ref}>
    <Suspense fallback={null}><A /></Suspense><B />
  </ChartContainer>);
  expect(drawOrder(plot(), log)).toEqual(['A0', 'B0']);
  await act(async () => updateA(1));
  await act(async () => updateB(1));
  expect(drawOrder(plot(), log)).toEqual(['A0', 'B1']);
  await act(async () => updateA(0));
  expect(drawOrder(plot(), log)).toEqual(['A0', 'B1']);
});

it('keeps committed JSX ranks when an abandoned parent render precedes a child update', async () => {
  const { deps, ref, plot } = setup();
  const log: string[] = [];
  let reverse = (_value: boolean) => {};
  let updateB = (_value: number) => {};
  function B() {
    const [value, setValue] = useState(0);
    updateB = setValue;
    return <ChartSeries series={fakeSeries(`B${value}`, log)} />;
  }
  function Parent() {
    const [pending, setPending] = useState(false);
    reverse = setPending;
    const children = [
      <ChartSeries key="A" series={fakeSeries('A', log)} />,
      <B key="B" />,
      <ChartSeries key="C" series={fakeSeries('C', log)} />,
    ];
    return <>
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        {pending ? children.reverse() : children}
      </ChartContainer>
      {pending && <NeverResolves />}
    </>;
  }
  mount(<Suspense fallback={null}><Parent /></Suspense>);
  expect(drawOrder(plot(), log)).toEqual(['A', 'B0', 'C']);
  await act(async () => startTransition(() => reverse(true)));
  await act(async () => updateB(1));
  expect(drawOrder(plot(), log)).toEqual(['A', 'B1', 'C']);
});

it('preserves JSX order across series inside and outside the main ChartPane', () => {
  const { deps, ref, plot } = setup();
  const log: string[] = [];
  const view = (middle: boolean) => <ChartContainer deps={deps} data={data} plotRef={ref}>
    <ChartPane>
      <ChartSeries series={fakeSeries('inside-first', log)} />
      {middle && <ChartSeries series={fakeSeries('inside-next', log)} />}
    </ChartPane>
    <ChartSeries series={fakeSeries('outside', log)} />
  </ChartContainer>;
  const mounted = mount(view(false));
  expect(drawOrder(plot(), log)).toEqual(['inside-first', 'outside']);
  mounted.rerender(view(true));
  expect(drawOrder(plot(), log)).toEqual(['inside-first', 'inside-next', 'outside']);
});


it('keeps outside series when the main ChartPane is replaced by key', () => {
  const { deps, ref, plot } = setup();
  const log: string[] = [];
  const view = (key: string) => <ChartContainer deps={deps} data={data} plotRef={ref}>
    <ChartPane key={key}>
      <ChartSeries series={fakeSeries(`inside-${key}`, log)} />
    </ChartPane>
    <ChartSeries series={fakeSeries('outside', log)} />
  </ChartContainer>;
  const mounted = mount(view('a'));
  expect(drawOrder(plot(), log)).toEqual(['inside-a', 'outside']);
  mounted.rerender(view('b'));
  expect(drawOrder(plot(), log)).toEqual(['inside-b', 'outside']);
  mounted.rerender(view('c'));
  expect(drawOrder(plot(), log)).toEqual(['inside-c', 'outside']);
});

it('updates derived line coordinates consistently for drawing and readouts', () => {
  const { deps, ref, plot } = setup();
  const points = [{ x: 0, a: 10, b: 100 }, { x: 1, a: 20, b: 200 }];
  type Point = (typeof points)[number];
  const derive = (source: DataView<Point>) => [...source];
  const a = { getX: (p: Point) => p.x, getY: (p: Point) => p.a };
  const b = { getX: (p: Point) => p.x, getY: (p: Point) => p.b };
  const view = (coordinates: typeof a) => <ChartContainer deps={deps} data={points} plotRef={ref}>
    <ChartLine derive={derive} deriveKey={[]} coordinates={coordinates} name="price" />
  </ChartContainer>;
  const mounted = mount(view(a));
  expect(plot().mainPane.probe(0)[0].value).toBe(10);
  mounted.rerender(view(b));
  expect(plot().mainPane.valueExtent()).toEqual({ min: 100, max: 200 });
  expect(plot().mainPane.probe(0)[0].value).toBe(100);
});

it('retains the derived ChartLine cache when default coordinates are unchanged', () => {
  const { deps, ref, plot } = setup();
  const calls = { n: 0 };
  const derive = countingDerive(calls);
  const view = (color: string) => <ChartContainer deps={deps} data={data} plotRef={ref}>
    <ChartLine derive={derive} deriveKey={[20]} style={{ line: { color } }} />
  </ChartContainer>;
  const mounted = mount(view('red'));
  expect(calls.n).toBe(1);
  mounted.rerender(view('blue'));
  expect(calls.n).toBe(1);
  expect(plot().mainPane.probe(0)[0].value).toBe(20);
});

describe('a re-rendered line with a new colour or name', () => {
  it('shows the new colour and name wherever the series is read, not only in the stroke', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const ref = { current: null as Plot | null };
    const ui = (color: string, name: string) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartLine style={{ line: { color } }} name={name} />
      </ChartContainer>
    );
    const view = render(ui('red', 'MA(5)'));

    act(() => view.rerender(ui('blue', 'MA(20)')));

    expect(ref.current?.mainPane.probe(50)[0]).toMatchObject({ color: 'blue', name: 'MA(20)' });
  });
});
