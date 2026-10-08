/**
 * A `<ChartPane>`'s pane arrives with its layout effects and leaves with its
 * passive cleanup: unmounted, deleted while hidden, swapped by key. A
 * Suspense boundary hiding it runs no passive cleanup, so the pane stays as it
 * is and a reveal applies the props it has now. The whole chart going is not
 * a pane going: the chart's own teardown takes its panes.
 */
import type { LineDataPoint, Pane, PluginApi, Plot } from '@finchart/core';
import { lineSeries, LogScale } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, Profiler, type ReactNode, StrictMode, startTransition, Suspense, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries, Plugin } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const series = { price: lineSeries(), rsi: lineSeries(), macd: lineSeries(), late: lineSeries() };
type Name = keyof typeof series;
const NAMES: readonly Name[] = ['price', 'rsi', 'macd', 'late'];
const nameOf = new Map<unknown, Name>(NAMES.map((name) => [series[name], name]));
const keys = (plot: Plot) => plot.panes.map((pane) => nameOf.get(pane.getSeries()[0]) ?? 'empty');
const deps = () => browserDeps({ createLayers: layersSpy().createLayers });

function current(ref: { current: Plot | null }): Plot {
  if (!ref.current) throw new Error('plot is not mounted');
  return ref.current;
}

/** A Suspense gate that suspends once, then resolves. */
function gate() {
  let resolve = () => {};
  let done = false;
  const pending = new Promise<void>((settle) => {
    resolve = () => {
      done = true;
      settle();
    };
  });
  let turnOn = () => {};
  function Gate() {
    const [on, setOn] = useState(false);
    turnOn = () => setOn(true);
    if (on && !done) throw pending;
    return null;
  }
  return {
    Gate,
    suspend: () => act(() => turnOn()),
    suspendInTransition: () => act(() => startTransition(() => turnOn())),
    /** Lets the gate through without waiting for React's retry. */
    open: () => resolve(),
    reveal: () =>
      act(async () => {
        resolve();
        await pending;
      }),
  };
}

/** Counts `panesChange` on a chart. */
function listen(plot: Plot) {
  const heard = { count: 0 };
  plot.on('panesChange', () => heard.count++);
  return heard;
}

describe('Suspense hiding the whole chart', () => {
  function setup() {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    let setNames = (_names: Name[]) => {};
    let setLog = (_on: boolean) => {};
    function Host() {
      const [names, set] = useState<Name[]>(['price', 'rsi', 'macd']);
      const [log, setLogState] = useState(true);
      setNames = set;
      setLog = setLogState;
      return (
        <Suspense fallback={null}>
          <Gate />
          <ChartContainer deps={deps()} data={data} plotRef={ref}>
            {names.map((name) => (
              <ChartPane key={name} yScale={name === 'price' && log ? () => new LogScale() : undefined}>
                <ChartSeries series={series[name]} />
              </ChartPane>
            ))}
          </ChartContainer>
        </Suspense>
      );
    }
    render(<Host />);
    const plot = current(ref);
    return {
      plot,
      suspend,
      reveal,
      show: (names: Name[]) => act(() => setNames(names)),
      log: (on: boolean) => act(() => setLog(on)),
    };
  }

  it('leaves the panes as they are, announcing nothing, and keeps what the main pane had', async () => {
    const { plot, suspend, reveal, show } = setup();
    const before = plot.panes;
    const heard = listen(plot);

    suspend();
    expect(plot.panes).toEqual(before);
    await reveal();

    expect(heard.count).toBe(0);
    expect(plot.panes).toHaveLength(3);
    plot.panes.forEach((pane, at) => expect(pane).toBe(before[at]));
    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
    expect(plot.mainPane.yScale.kind).toBe('log');
    // The scale the `yScale` replaced is still there to put back.
    show(['rsi', 'macd']);
    expect(plot.mainPane.yScale.kind).toBe('linear');
  });

  it('applies the props that changed while hidden once it shows again', async () => {
    const { plot, suspend, reveal, log } = setup();

    suspend();
    log(false);
    await reveal();

    expect(plot.mainPane.yScale.kind).toBe('linear');
    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
  });

  // A deletion inside the hidden chart commits with the reveal, so the pane
  // is released then, by the chart shown again.
  it('removes a pane deleted while hidden, once it shows again', async () => {
    const { plot, suspend, reveal, show } = setup();
    const macd = plot.panes[2];

    suspend();
    show(['price', 'macd']);
    await reveal();

    expect(keys(plot)).toEqual(['price', 'macd']);
    expect(plot.panes[1]).toBe(macd);
  });

  it('gives the main pane back, with its own scale, once it shows again after the pane holding it was deleted', async () => {
    const { plot, suspend, reveal, show } = setup();

    suspend();
    show(['rsi', 'macd']);
    await reveal();

    expect(plot.mainPane.yScale.kind).toBe('linear');
    expect(plot.mainPane.getSeries()).toEqual([]);
    expect(keys(plot)).toEqual(['empty', 'rsi', 'macd']);
    // Unclaimed, not leaked: the next pane to mount takes it instead of adding one.
    show(['price', 'rsi', 'macd']);
    expect(plot.panes).toHaveLength(3);
    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
    expect(plot.mainPane.yScale.kind).toBe('log');
  });
});

describe('one pane hidden by its own Suspense boundary', () => {
  function setup() {
    const ref = createRef<Plot>();
    const { Gate, suspend, suspendInTransition, reveal } = gate();
    let set = (_props: { flex?: number; log?: boolean; domain?: readonly [number, number] }) => {};
    // A component inside the pane holding its own React state.
    const inner = { count: 0, bump: () => {} };
    function Inner() {
      const [count, setCount] = useState(0);
      inner.count = count;
      inner.bump = () => setCount((value) => value + 1);
      return null;
    }
    function Rsi() {
      const [props, setProps] = useState<{ flex?: number; log?: boolean; domain?: readonly [number, number] }>({});
      set = setProps;
      return (
        <Suspense fallback={null}>
          <Gate />
          <ChartPane flex={props.flex} yScale={props.log ? () => new LogScale() : undefined} valueDomain={props.domain}>
            <ChartSeries series={series.rsi} />
            <Inner />
          </ChartPane>
        </Suspense>
      );
    }
    render(
      <ChartContainer deps={deps()} data={data} plotRef={ref}>
        <ChartPane><ChartSeries series={series.price} /></ChartPane>
        <Rsi />
        <ChartPane><ChartSeries series={series.macd} /></ChartPane>
      </ChartContainer>,
    );
    const plot = current(ref);
    return { plot, suspend, suspendInTransition, reveal, inner, set: (props: Parameters<typeof set>[0]) => act(() => set(props)) };
  }

  it('stays on the chart while hidden, with its series, announcing nothing', () => {
    const { plot, suspend } = setup();
    const before = plot.panes;
    const heard = listen(plot);

    suspend();

    expect(plot.panes).toEqual(before);
    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
    expect(heard.count).toBe(0);
  });

  it('keeps what the user did, the user’s order and the state inside it', async () => {
    const { plot, suspend, reveal, inner } = setup();
    const rsi = plot.panes[1];
    // What a divider drag and an axis drag leave behind.
    act(() => {
      rsi.applyOptions({ flex: 7 });
      rsi.setValueDomain(-5, 5);
      plot.setPaneOrder([...plot.panes].reverse());
      inner.bump();
    });

    suspend();
    await reveal();

    expect(keys(plot)).toEqual(['macd', 'rsi', 'price']);
    expect(plot.panes[1]).toBe(rsi);
    expect(rsi.flex).toBe(7);
    expect(rsi.autoScale).toBe(false);
    expect(rsi.yScale.getDomain()).toEqual([-5, 5]);
    expect(inner.count).toBe(1);
  });

  it('applies the props that changed while hidden when it shows again', async () => {
    const { plot, suspend, reveal, set } = setup();
    const rsi = plot.panes[1];

    suspend();
    set({ flex: 3, log: true, domain: [1, 100] });
    await reveal();

    expect(plot.panes[1]).toBe(rsi);
    expect(rsi.flex).toBe(3);
    expect(rsi.yScale.kind).toBe('log');
    expect(rsi.autoScale).toBe(false);
    expect(rsi.yScale.getDomain()).toEqual([1, 100]);
  });

  it('stays the same way when the suspending update is a transition', async () => {
    const { plot, suspendInTransition, reveal, inner } = setup();
    const rsi = plot.panes[1];
    act(() => inner.bump());

    suspendInTransition();
    expect(plot.panes[1]).toBe(rsi);
    await reveal();

    expect(plot.panes[1]).toBe(rsi);
    expect(inner.count).toBe(1);
  });
});

it('keeps a hidden pane holding the main pane there, with its series and scale', async () => {
  const ref = createRef<Plot>();
  const { Gate, suspend, reveal } = gate();
  render(
    <ChartContainer deps={deps()} data={data} plotRef={ref}>
      <Suspense fallback={null}>
        <Gate />
        <ChartPane yScale={() => new LogScale()}><ChartSeries series={series.price} /></ChartPane>
      </Suspense>
      <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
      {/* Outside every pane, so on the main pane whoever holds it. */}
      <ChartSeries series={series.late} />
    </ChartContainer>,
  );
  const plot = current(ref);

  suspend();
  expect(plot.mainPane.getSeries()).toEqual([series.price, series.late]);
  expect(plot.mainPane.yScale.kind).toBe('log');
  await reveal();

  expect(keys(plot)).toEqual(['price', 'rsi']);
  expect(plot.mainPane.getSeries()).toEqual([series.price, series.late]);
  expect(plot.mainPane.yScale.kind).toBe('log');
});

/**
 * The main pane's holder hidden is "down", like a keyed swap's departing
 * holder; a settle waits one round for such a holder to be released, but
 * only when a pane arrives, and only once — the holder hidden by Suspense is
 * never released, so a second wait would never end.
 */
describe('a hidden pane holding the main pane', () => {
  function setup() {
    const ref = createRef<Plot>();
    const main = gate();
    const other = gate();
    let set = (_keys: Array<'rsi' | 'late'>) => {};
    const counted = { commits: 0 };
    function Host() {
      const [keys, setKeys] = useState<Array<'rsi' | 'late'>>(['rsi']);
      set = setKeys;
      return (
        <Profiler id="chart" onRender={() => void counted.commits++}>
          <ChartContainer deps={deps()} data={data} plotRef={ref}>
            <Suspense fallback={null}>
              <main.Gate />
              <ChartPane><ChartSeries series={series.price} /></ChartPane>
            </Suspense>
            {keys.map((key) => <ChartPane key={key}><ChartSeries series={series[key]} /></ChartPane>)}
            <Suspense fallback={null}>
              <other.Gate />
              <ChartPane><ChartSeries series={series.macd} /></ChartPane>
            </Suspense>
          </ChartContainer>
        </Profiler>
      );
    }
    render(<Host />);
    return { plot: current(ref), main, other, counted, set: (keys: Array<'rsi' | 'late'>) => act(() => set(keys)) };
  }

  it('lets a pane arrive beside it, keeping the main pane', async () => {
    const { plot, main, set } = setup();
    const mainPane = plot.mainPane;

    main.suspend();
    set(['rsi', 'late']);

    expect(keys(plot)).toEqual(['price', 'rsi', 'late', 'macd']);
    expect(plot.mainPane.getSeries()).toEqual([series.price]);
    await main.reveal();
    expect(keys(plot)).toEqual(['price', 'rsi', 'late', 'macd']);
    expect(plot.mainPane).toBe(mainPane);
  });

  /** The one-round wait is for a pane arriving; another pane coming back has nothing to wait for. */
  it('costs another pane coming back no more commits than when it is shown', async () => {
    const commitsToReveal = async (hideMain: boolean) => {
      const { main, other, counted } = setup();
      if (hideMain) main.suspend();
      other.suspend();
      counted.commits = 0;
      await other.reveal();
      const commits = counted.commits;
      cleanup();
      return commits;
    };

    expect(await commitsToReveal(true)).toBe(await commitsToReveal(false));
  });
});

/**
 * A component inside a pane that suspends hides the pane's own boundary. If
 * hiding took the pane off the chart, the pane would stop rendering its
 * children — the component that suspended among them — the boundary would
 * show it again, the pane would come back and render it, and it would
 * suspend again, without end.
 */
describe('a component inside a pane suspending', () => {
  function pending() {
    let resolve = () => {};
    let done = false;
    const promise = new Promise<void>((settle) => {
      resolve = () => {
        done = true;
        settle();
      };
    });
    return {
      when: (suspend: boolean) => {
        if (suspend && !done) throw promise;
      },
      resolve: () =>
        act(async () => {
          resolve();
          await promise;
        }),
    };
  }
  /** Runs `step`, returning what it threw and what React logged as an error. */
  function attempt(step: () => void) {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let thrown: unknown = null;
    try {
      step();
    } catch (error) {
      thrown = error;
    }
    const errors = logged.mock.calls.length;
    logged.mockRestore();
    return { thrown, errors };
  }

  it('on the first mount', async () => {
    const wait = pending();
    const ref = createRef<Plot>();
    function Fetching() {
      wait.when(true);
      return <ChartSeries series={series.rsi} />;
    }

    const outcome = attempt(() => {
      render(
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane><ChartSeries series={series.price} /></ChartPane>
          <Suspense fallback={null}>
            <ChartPane><Fetching /></ChartPane>
          </Suspense>
        </ChartContainer>,
      );
    });
    await wait.resolve();

    expect(outcome).toEqual({ thrown: null, errors: 0 });
    expect(keys(current(ref))).toEqual(['price', 'rsi']);
  });

  const lanes: ReadonlyArray<'sync' | 'transition'> = ['sync', 'transition'];
  for (const lane of lanes) {
    it(`on a ${lane} update`, async () => {
      const wait = pending();
      const ref = createRef<Plot>();
      let setPeriod = (_period: number) => {};
      function Fetching({ period }: { period: number }) {
        wait.when(period === 2);
        return <ChartSeries series={series.rsi} />;
      }
      function Host() {
        const [period, set] = useState(1);
        setPeriod = set;
        return (
          <ChartContainer deps={deps()} data={data} plotRef={ref}>
            <ChartPane><ChartSeries series={series.price} /></ChartPane>
            <Suspense fallback={null}>
              <ChartPane><Fetching period={period} /></ChartPane>
            </Suspense>
          </ChartContainer>
        );
      }
      render(<Host />);
      const plot = current(ref);
      const rsi = plot.panes[1];

      const outcome = attempt(() =>
        act(() => (lane === 'sync' ? setPeriod(2) : startTransition(() => setPeriod(2)))),
      );
      await wait.resolve();

      expect(outcome).toEqual({ thrown: null, errors: 0 });
      expect(keys(plot)).toEqual(['price', 'rsi']);
      expect(plot.panes[1]).toBe(rsi);
    });
  }

  it('in a pane added in a transition', async () => {
    const wait = pending();
    const ref = createRef<Plot>();
    let add = () => {};
    function Fetching() {
      wait.when(true);
      return <ChartSeries series={series.rsi} />;
    }
    function Host() {
      const [more, setMore] = useState(false);
      add = () => setMore(true);
      return (
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane><ChartSeries series={series.price} /></ChartPane>
          <Suspense fallback={null}>
            {more && <ChartPane><Fetching /></ChartPane>}
          </Suspense>
        </ChartContainer>
      );
    }
    render(<Host />);

    const outcome = attempt(() => act(() => startTransition(() => add())));
    await wait.resolve();

    expect(outcome).toEqual({ thrown: null, errors: 0 });
    expect(keys(current(ref))).toEqual(['price', 'rsi']);
  });
});

describe('a pane hidden by its own Suspense boundary, and the panes around it', () => {
  const four = { a: lineSeries(), b: lineSeries(), c: lineSeries(), d: lineSeries() };
  const label = new Map<unknown, string>(Object.entries(four).map(([name, s]) => [s, name]));
  const labels = (plot: Plot) => plot.panes.map((pane) => label.get(pane.getSeries()[0]) ?? 'empty');

  it("keeps the user's order across a data tick while it is hidden", async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    let tick = () => {};
    function Host() {
      const [k, setK] = useState(0);
      tick = () => setK((value) => value + 1);
      return (
        <ChartContainer deps={deps()} data={k ? [...data] : data} plotRef={ref}>
          <ChartPane><ChartSeries series={four.a} /></ChartPane>
          <Suspense fallback={null}>
            <Gate />
            <ChartPane><ChartSeries series={four.b} /></ChartPane>
          </Suspense>
          <ChartPane><ChartSeries series={four.c} /></ChartPane>
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));
    const heard = listen(plot);

    suspend();
    act(() => tick());
    await reveal();

    expect(labels(plot)).toEqual(['c', 'b', 'a']);
    expect(heard.count).toBe(0);
  });

  it("keeps the user's order when a pane before it goes while it is hidden", async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    let drop = () => {};
    function Host() {
      const [all, setAll] = useState(true);
      drop = () => setAll(false);
      return (
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane key="a"><ChartSeries series={four.a} /></ChartPane>
          {all && <ChartPane key="b"><ChartSeries series={four.b} /></ChartPane>}
          <Suspense key="c" fallback={null}>
            <Gate />
            <ChartPane><ChartSeries series={four.c} /></ChartPane>
          </Suspense>
          <ChartPane key="d"><ChartSeries series={four.d} /></ChartPane>
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    suspend();
    act(() => drop());
    await reveal();

    expect(labels(plot)).toEqual(['d', 'c', 'a']);
  });

  for (const gone of [['b'], ['a', 'b']]) {
    it(`stays where it was when ${gone.join(' and ')} before it go${gone.length > 1 ? '' : 'es'} and a pane arrives at the end`, async () => {
      const ref = createRef<Plot>();
      const { Gate, suspend, reveal } = gate();
      const five = { ...four, e: lineSeries() };
      label.set(five.e, 'e');
      let set = (_state: { present: boolean; last: boolean }) => {};
      function Host() {
        const [state, setState] = useState({ present: true, last: false });
        set = setState;
        return (
          <ChartContainer deps={deps()} data={data} plotRef={ref}>
            <ChartPane key="m"><ChartSeries series={series.price} /></ChartPane>
            {state.present && gone.includes('a') && <ChartPane key="a"><ChartSeries series={five.a} /></ChartPane>}
            {state.present && <ChartPane key="b"><ChartSeries series={five.b} /></ChartPane>}
            <Suspense key="c" fallback={null}>
              <Gate />
              <ChartPane><ChartSeries series={five.c} /></ChartPane>
            </Suspense>
            <ChartPane key="d"><ChartSeries series={five.d} /></ChartPane>
            {state.last && <ChartPane key="e"><ChartSeries series={five.e} /></ChartPane>}
          </ChartContainer>
        );
      }
      render(<Host />);
      const plot = current(ref);
      const named = () => plot.panes.map((pane) => (pane.getSeries()[0] === series.price ? 'm' : label.get(pane.getSeries()[0])));

      suspend();
      act(() => set({ present: false, last: false }));
      expect(named()).toEqual(['m', 'c', 'd']);
      act(() => set({ present: false, last: true }));
      expect(named()).toEqual(['m', 'c', 'd', 'e']);
      await reveal();

      expect(named()).toEqual(['m', 'c', 'd', 'e']);
    });
  }

  /**
   * A reveal rendered by a render of the container, with the hidden pane last:
   * no rank around it moves, yet panes moved around it while it was hidden,
   * so coming back alone has to settle the order again.
   */
  it('goes back to its JSX place when the container’s own render shows it', async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, open } = gate();
    let set = (_keys: Array<'a' | 'b'>) => {};
    let tick = () => {};
    function Host() {
      const [keys, setKeys] = useState<Array<'a' | 'b'>>(['a']);
      const [t, setT] = useState(0);
      set = setKeys;
      tick = () => setT((value) => value + 1);
      return (
        <ChartContainer deps={deps()} data={t ? [...data] : data} plotRef={ref}>
          <ChartPane key="m"><ChartSeries series={series.price} /></ChartPane>
          {keys.map((key) => <ChartPane key={key}><ChartSeries series={four[key]} /></ChartPane>)}
          <Suspense key="c" fallback={null}>
            <Gate />
            <ChartPane><ChartSeries series={four.c} /></ChartPane>
          </Suspense>
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);
    const named = () => plot.panes.map((pane) => (pane.getSeries()[0] === series.price ? 'm' : label.get(pane.getSeries()[0])));

    suspend();
    act(() => set([]));
    act(() => set(['b']));
    expect(named()).toEqual(['m', 'c', 'b']);
    act(() => {
      open();
      tick();
    });
    await act(async () => {});

    expect(named()).toEqual(['m', 'b', 'c']);
  });

  /**
   * The documented limit: a hidden pane can't take a new JSX place, so one
   * inserted beside it can sit on the wrong side until it shows again, and
   * the reveal puts the panes in JSX order.
   */
  it('lets a pane inserted beside it sit on the wrong side until it shows again', async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    let add = () => {};
    function Host() {
      const [more, setMore] = useState(false);
      add = () => setMore(true);
      return (
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane><ChartSeries series={four.a} /></ChartPane>
          {more && <ChartPane><ChartSeries series={four.b} /></ChartPane>}
          <Suspense fallback={null}>
            <Gate />
            <ChartPane><ChartSeries series={four.c} /></ChartPane>
          </Suspense>
          <ChartPane><ChartSeries series={four.d} /></ChartPane>
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = current(ref);

    suspend();
    act(() => add());
    expect(labels(plot)).toEqual(['a', 'c', 'b', 'd']);
    await reveal();

    expect(labels(plot)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the whole chart going', () => {
  function tree(ref: { current: Plot | null }, disposed: Pane[], key = 'a') {
    const counted = (pane: Pane): PluginApi => {
      const api = {
        disposed: false,
        dispose() {
          if (api.disposed) return;
          api.disposed = true;
          disposed.push(pane);
        },
      };
      return api;
    };
    return (
      <ChartContainer key={key} deps={deps()} data={data} plotRef={ref}>
        <ChartPane yScale={() => new LogScale()}><ChartSeries series={series.price} /></ChartPane>
        <ChartPane>
          <ChartSeries series={series.rsi} />
          <Plugin install={(_plot, pane) => pane.use(counted)} />
        </ChartPane>
      </ChartContainer>
    );
  }

  it('leaves the panes to the chart’s own teardown', () => {
    const ref = createRef<Plot>();
    const disposed: Pane[] = [];
    const view = render(tree(ref, disposed));
    const plot = current(ref);
    const rsi = plot.panes[1];
    const heard = listen(plot);
    const removePane = vi.spyOn(plot, 'removePane');

    view.unmount();
    const removed = removePane.mock.calls.length;
    removePane.mockRestore();

    expect(heard.count).toBe(0);
    expect(removed).toBe(0);
    expect(disposed).toEqual([rsi]);
  });

  it('under a new key leaves the old chart’s panes to its teardown', () => {
    const ref = createRef<Plot>();
    const disposed: Pane[] = [];
    const view = render(tree(ref, disposed));
    const plot = current(ref);
    const heard = listen(plot);
    const removePane = vi.spyOn(plot, 'removePane');

    act(() => view.rerender(tree(ref, disposed, 'b')));
    const removed = removePane.mock.calls.length;
    removePane.mockRestore();

    expect(heard.count).toBe(0);
    expect(removed).toBe(0);
    expect(current(ref)).not.toBe(plot);
    expect(keys(current(ref))).toEqual(['price', 'rsi']);
  });
});

describe('a pane removed while the chart stays', () => {
  function setup() {
    const ref = createRef<Plot>();
    const toggles = { price: (_on: boolean) => {}, rsi: (_on: boolean) => {} };
    function Toggle({ name, children }: { name: 'price' | 'rsi'; children: ReactNode }) {
      const [on, setOn] = useState(true);
      toggles[name] = setOn;
      return on ? children : null;
    }
    render(
      <ChartContainer deps={deps()} data={data} plotRef={ref}>
        <Toggle name="price">
          <ChartPane yScale={() => new LogScale()}><ChartSeries series={series.price} /></ChartPane>
        </Toggle>
        <Toggle name="rsi">
          <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
        </Toggle>
        <ChartPane><ChartSeries series={series.macd} /></ChartPane>
      </ChartContainer>,
    );
    const plot = current(ref);
    return { plot, toggle: (name: 'price' | 'rsi', on: boolean) => act(() => toggles[name](on)) };
  }

  it('is removed and announced', () => {
    const { plot, toggle } = setup();
    const heard = listen(plot);

    toggle('rsi', false);

    expect(keys(plot)).toEqual(['price', 'macd']);
    expect(heard.count).toBeGreaterThan(0);
  });

  it('comes back in place, and the main pane goes to the first pane to mount after its own went', () => {
    const { plot, toggle } = setup();

    toggle('price', false);
    expect(plot.mainPane.yScale.kind).toBe('linear');
    toggle('rsi', false);
    toggle('rsi', true);
    toggle('price', true);

    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
    expect(plot.panes).toHaveLength(3);
    expect(plot.mainPane.getSeries()).toEqual([series.rsi]);
    expect(plot.panes[0].yScale.kind).toBe('log');
    expect(plot.mainPane.yScale.kind).toBe('linear');
  });
});

describe('StrictMode', () => {
  it('builds each pane once, in JSX order, with its series', () => {
    const ref = createRef<Plot>();
    const made: LogScale[] = [];
    let turnOn = () => {};
    function Late() {
      const [on, setOn] = useState(false);
      turnOn = () => setOn(true);
      return on ? <ChartPane><ChartSeries series={series.late} /></ChartPane> : null;
    }
    render(
      <StrictMode>
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane yScale={() => {
            const scale = new LogScale();
            made.push(scale);
            return scale;
          }}><ChartSeries series={series.price} /></ChartPane>
          <Late />
          <ChartPane><ChartSeries series={series.macd} /></ChartPane>
        </ChartContainer>
      </StrictMode>,
    );
    const plot = current(ref);
    const heard = listen(plot);

    act(() => turnOn());

    expect(keys(plot)).toEqual(['price', 'late', 'macd']);
    expect(plot.panes.map((pane) => pane.getSeries().length)).toEqual([1, 1, 1]);
    // Built once: the replay declares the same render again, which is no
    // change, and later commits call the factory without installing its
    // scale while the kind stays.
    expect(plot.mainPane.yScale).toBe(made[0]);
    // The late pane arrives in its place: added, then put there — no more.
    expect(heard.count).toBe(2);
  });
});

/**
 * The documented other side: a pane added by a render of the container is
 * built in that commit, so the replay that follows takes it off and builds
 * it again, as it would any pane built before the replay runs.
 */
it('under StrictMode builds a pane the container adds later twice, ending with one', () => {
  const ref = createRef<Plot>();
  let built = 0;
  let add = () => {};
  function Host() {
    const [more, setMore] = useState(false);
    add = () => setMore(true);
    return (
      <StrictMode>
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane><ChartSeries series={series.price} /></ChartPane>
          {more && (
            <ChartPane
              yScale={() => {
                built += 1;
                return new LogScale();
              }}
            >
              <ChartSeries series={series.rsi} />
            </ChartPane>
          )}
        </ChartContainer>
      </StrictMode>
    );
  }
  render(<Host />);

  act(() => add());

  expect(built).toBe(2);
  expect(keys(current(ref))).toEqual(['price', 'rsi']);
  expect(current(ref).panes[1].yScale.kind).toBe('log');
});

describe('StrictMode rebuilding a pane', () => {
  it('places a pane the container inserts mid-stack where the JSX puts it', () => {
    const ref = createRef<Plot>();
    let show = (_names: Array<'price' | 'rsi' | 'macd'>) => {};
    function Host() {
      const [names, setNames] = useState<Array<'price' | 'rsi' | 'macd'>>(['price', 'macd']);
      show = setNames;
      return (
        <StrictMode>
          <ChartContainer deps={deps()} data={data} plotRef={ref}>
            {names.map((name) => <ChartPane key={name}><ChartSeries series={series[name]} /></ChartPane>)}
          </ChartContainer>
        </StrictMode>
      );
    }
    render(<Host />);

    act(() => show(['price', 'rsi', 'macd']));

    expect(keys(current(ref))).toEqual(['price', 'rsi', 'macd']);
  });

  /**
   * React 19's StrictMode also replays effects when a Suspense boundary
   * shows its content again, so there the pane is released and built afresh
   * — an arrival, restacked to JSX order. React 18 keeps it, and the order.
   */
  it('puts a pane rebuilt on a Suspense reveal in its JSX place', async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    render(
      <StrictMode>
        <ChartContainer deps={deps()} data={data} plotRef={ref}>
          <ChartPane><ChartSeries series={series.price} /></ChartPane>
          <Suspense fallback={null}>
            <Gate />
            <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
          </Suspense>
          <ChartPane><ChartSeries series={series.macd} /></ChartPane>
        </ChartContainer>
      </StrictMode>,
    );
    const plot = current(ref);
    const rsi = plot.panes[1];
    act(() => plot.setPaneOrder([...plot.panes].reverse()));

    suspend();
    await reveal();

    const rebuilt = plot.panes.find((pane) => pane.getSeries()[0] === series.rsi) !== rsi;
    expect(keys(plot)).toEqual(rebuilt ? ['price', 'rsi', 'macd'] : ['macd', 'rsi', 'price']);
  });

  it('places a pane added after the whole chart showed again', async () => {
    const ref = createRef<Plot>();
    const { Gate, suspend, reveal } = gate();
    let show = (_names: Array<'price' | 'rsi' | 'macd'>) => {};
    function Host() {
      const [names, setNames] = useState<Array<'price' | 'rsi' | 'macd'>>(['price', 'rsi', 'macd']);
      show = setNames;
      return (
        <StrictMode>
          <Suspense fallback={null}>
            <Gate />
            <ChartContainer deps={deps()} data={data} plotRef={ref}>
              {names.map((name) => (
                <ChartPane key={name} yScale={name === 'price' ? () => new LogScale() : undefined}>
                  <ChartSeries series={series[name]} />
                </ChartPane>
              ))}
            </ChartContainer>
          </Suspense>
        </StrictMode>
      );
    }
    render(<Host />);

    suspend();
    act(() => show(['rsi', 'macd']));
    await reveal();
    act(() => show(['price', 'rsi', 'macd']));

    const plot = current(ref);
    expect(keys(plot)).toEqual(['price', 'rsi', 'macd']);
    expect(plot.panes).toHaveLength(3);
    expect(plot.panes[0].yScale.kind).toBe('log');
  });
});

it('renders panes on the server without a warning', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const html = renderToString(
      <ChartContainer deps={deps()} data={data}>
        <ChartPane><ChartSeries series={series.price} /></ChartPane>
        <ChartPane><ChartSeries series={series.rsi} /></ChartPane>
      </ChartContainer>,
    );

    expect(html).toContain('<div');
    expect(error).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
