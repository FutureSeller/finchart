/**
 * `useInfiniteHistory` + `<InfiniteHistory>` — history whose place outlives
 * the chart.
 *
 * A consumer used to carry it by hand: the held bars in a ref, the paging
 * token caught by wrapping its own fetch, a load counter to drop late
 * pages, the loader lifted out through an effect for its status. Two
 * defects came out of that glue in a row — a remount asked for the first
 * page again on top of bars that held it, and a page for the previous
 * symbol landed on the new one. Contracts: pages land in `data`; a
 * remounted chart resumes from the first bar held and the last token; a
 * load pages with the fetch it was reset with and nothing else; a page for
 * a load `reset` replaced is dropped; an end stays an end; the status is
 * state.
 */
import type { CoordinateAccessor, LineDataPoint, Plot } from '@finchart/core';
import { immediateScheduler, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode, startTransition, Suspense, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartSeries, InfiniteHistory } from '../components';
import { type InfiniteHistoryState, useInfiniteHistory } from '../hooks/use-infinite-history';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const LINE = lineSeries();

const points = (from: number, to: number): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x < to; x++) out.push({ x, y: 1 });
  return out;
};

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function makeDeps() {
  return browserDeps({
    createLayers: layersSpy().createLayers,
    createScheduler: immediateScheduler,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
}

type Page = { bars: LineDataPoint[]; next: string | null };
type History = InfiniteHistoryState<LineDataPoint, string>;

/** Serves pages by token; records each token asked, under the given name. */
function pagesByToken(book: Record<string, Page>, asked: string[] = [], name = '') {
  const fetchPage = (token: string): Promise<Page> => {
    asked.push(name + token);
    return Promise.resolve(book[token] ?? { bars: [], next: null });
  };
  return { asked, fetchPage };
}

/** A chart paging a history; `chartKey` remounts the chart, `paging` mounts `<InfiniteHistory>`. */
function harness(strict = false) {
  const deps = makeDeps();
  const plotRef = createRef<Plot>();
  const out: { history: History | null } = { history: null };

  function App({ chartKey = 'a', paging = true }: { chartKey?: string; paging?: boolean }) {
    const history = useInfiniteHistory<LineDataPoint, string>();
    out.history = history;
    const chart = (
      <ChartContainer key={chartKey} deps={deps} data={[]} plotRef={plotRef}>
        <ChartSeries series={LINE} data={history.data} />
        {paging && <InfiniteHistory history={history} />}
      </ChartContainer>
    );
    return strict ? <StrictMode>{chart}</StrictMode> : chart;
  }
  const plot = () => {
    if (!plotRef.current) throw new Error('no chart');
    return plotRef.current;
  };
  const history = () => {
    if (!out.history) throw new Error('not rendered');
    return out.history;
  };
  return { App, plot, history };
}

describe('useInfiniteHistory', () => {
  it('lands pages in data and reads its status as state', async () => {
    const { fetchPage } = pagesByToken({ p2: { bars: points(80, 100), next: null } });
    const { App, plot, history } = harness();
    render(<App />);
    expect(history().status).toBeNull();

    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage }));
    expect(history().status).toBe('idle');

    act(() => plot().setVisibleRange(85, 110));
    await settle();

    expect(history().data).toEqual(points(80, 120));
    expect(history().status).toBe('done');
  });

  it('a remounted chart resumes from the last token — no page asked twice, no bar held twice', async () => {
    const { asked, fetchPage } = pagesByToken({
      p2: { bars: points(80, 100), next: 'p3' },
      p3: { bars: points(60, 80), next: null },
    });
    const { App, plot, history } = harness();
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage }));
    act(() => plot().setVisibleRange(95, 115));
    await settle();
    expect(asked).toEqual(['p2']);

    view.rerender(<App chartKey="b" />);
    act(() => plot().setVisibleRange(65, 90));
    await settle();

    expect(asked).toEqual(['p2', 'p3']);
    expect(history().data).toEqual(points(60, 120));
  });

  it('an end stays an end — across a remount, and while nothing is mounted', async () => {
    const { asked, fetchPage } = pagesByToken({ p2: { bars: points(80, 100), next: null } });
    const { App, plot, history } = harness();
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage }));
    act(() => plot().setVisibleRange(85, 110));
    await settle();
    expect(history().status).toBe('done');

    view.rerender(<App chartKey="a" paging={false} />);
    expect(history().status).toBe('done');

    view.rerender(<App chartKey="b" />);
    act(() => plot().setVisibleRange(70, 100));
    await settle();

    expect(asked).toEqual(['p2']);
    expect(history().status).toBe('done');
  });

  it('drops a page that lands after a reset — it belonged to the load before', async () => {
    let answer: (page: Page) => void = () => undefined;
    const late = (_token: string) =>
      new Promise<Page>((resolve) => {
        answer = resolve;
      });
    const { App, plot, history } = harness();
    render(<App />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage: late }));
    act(() => plot().setVisibleRange(85, 110));

    act(() => history().reset(points(500, 520), null));
    answer({ bars: points(80, 100), next: null });
    await settle();

    expect(history().data).toEqual(points(500, 520));
    expect(history().status).toBeNull();
  });

  /**
   * **A load pages with the fetch it was reset with.** The fetch comes with
   * the load, from the scope that received its first page — a later render
   * with another symbol, a chart that mounts late, a remount: none of them
   * can pair this load's token with another fetch.
   */
  it('pages with the fetch handed to reset — even when the chart mounts after the next symbol rendered', async () => {
    const asked: string[] = [];
    const a = pagesByToken({ p2: { bars: points(80, 100), next: null } }, asked, 'A:');
    const b = pagesByToken({ q2: { bars: points(480, 500), next: null } }, asked, 'B:');
    const { App, plot, history } = harness();
    const view = render(<App paging={false} />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage: a.fetchPage }));

    view.rerender(<App paging />);
    act(() => plot().setVisibleRange(85, 110));
    await settle();
    expect(asked).toEqual(['A:p2']);

    act(() => history().reset(points(500, 520), { next: 'q2', fetchPage: b.fetchPage }));
    act(() => plot().setVisibleRange(485, 510));
    await settle();
    expect(asked).toEqual(['A:p2', 'B:q2']);
  });

  it('reads null once no <InfiniteHistory> pages — removed mid-request', async () => {
    const pending = (_token: string) => new Promise<Page>(() => undefined);
    const { App, plot, history } = harness();
    const view = render(<App />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage: pending }));
    act(() => plot().setVisibleRange(85, 110));
    expect(history().status).toBe('loading');

    view.rerender(<App paging={false} />);
    expect(history().status).toBeNull();
  });

  it('pages through a copy of the history value — the link travels with it', async () => {
    const { asked, fetchPage } = pagesByToken({ p2: { bars: points(80, 100), next: null } });
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: History | null } = { history: null };
    function App() {
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <ChartContainer deps={deps} data={[]} plotRef={plotRef}>
          <ChartSeries series={LINE} data={history.data} />
          <InfiniteHistory history={{ ...history }} />
        </ChartContainer>
      );
    }
    render(<App />);
    act(() => out.history?.reset(points(100, 120), { next: 'p2', fetchPage }));
    act(() => plotRef.current?.setVisibleRange(85, 110));
    await settle();

    expect(asked).toEqual(['p2']);
    expect(out.history?.data).toEqual(points(80, 120));
  });

  it('pages by time, resuming from the first bar held — StrictMode included', async () => {
    const asked: number[] = [];
    const fetch = (before: number) => {
      asked.push(before);
      return before > 60 ? points(before - 20, before) : [];
    };
    const { App, plot, history } = harness(true);
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), { fetch }));
    act(() => plot().setVisibleRange(95, 115));
    await settle();
    expect(asked).toEqual([100]);

    view.rerender(<App chartKey="b" />);
    act(() => plot().setVisibleRange(65, 95));
    await settle();

    expect(asked).toEqual([100, 80]);
    expect(history().data).toEqual(points(60, 120));
  });

  it('an end by time stays an end across a remount — the empty page is not asked again', async () => {
    const asked: number[] = [];
    const fetch = (before: number) => {
      asked.push(before);
      return [];
    };
    const { App, plot, history } = harness();
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), { fetch }));
    act(() => plot().setVisibleRange(90, 110));
    await settle();
    expect(history().status).toBe('done');

    view.rerender(<App chartKey="b" />);
    act(() => plot().setVisibleRange(80, 100));
    await settle();

    expect(asked).toEqual([100]);
    expect(history().status).toBe('done');
  });

  it("pages by time from the first bar's x as the given accessor reads it", async () => {
    // Placed by `t`; the `x` field holds something else, so reading it would page from the wrong place.
    type Bar = { x: number; t: number; y: number };
    const BY_TIME: CoordinateAccessor<Bar> = { getX: (bar) => bar.t, getY: (bar) => bar.y };
    const bars = (from: number, to: number): Bar[] => {
      const out: Bar[] = [];
      for (let t = from; t < to; t++) out.push({ x: t - 1000, t, y: 1 });
      return out;
    };
    const series = lineSeries({ coordinates: BY_TIME });
    const asked: number[] = [];
    const fetch = (before: number) => {
      asked.push(before);
      return bars(before - 20, before);
    };
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: InfiniteHistoryState<Bar> | null } = { history: null };
    function App() {
      const history = useInfiniteHistory<Bar>({ coordinates: BY_TIME });
      out.history = history;
      return (
        <ChartContainer deps={deps} data={[]} plotRef={plotRef}>
          <ChartSeries series={series} data={history.data} />
          <InfiniteHistory history={history} />
        </ChartContainer>
      );
    }
    render(<App />);
    act(() => out.history?.reset(bars(100, 120), { fetch }));
    act(() => plotRef.current?.setVisibleRange(95, 115));
    await settle();

    expect(asked).toEqual([100]);
  });

  it('a load without paging holds its bars and asks nothing', async () => {
    const { App, plot, history } = harness();
    render(<App />);
    act(() => history().reset(points(100, 120), null));
    act(() => plot().setVisibleRange(85, 110));
    await settle();

    expect(history().data).toEqual(points(100, 120));
    expect(history().status).toBeNull();
  });

  /**
   * **A reset waiting in a transition doesn't reach the chart early.** The
   * bars and their load commit as one state, so an urgent render meanwhile
   * keeps paging the load on screen, from its own bars.
   */
  it('keeps paging the load on screen while a reset waits in a suspended transition', async () => {
    const asked: string[] = [];
    const a = pagesByToken({ p2: { bars: points(80, 100), next: null } }, asked, 'A:');
    const b = pagesByToken({}, asked, 'B:');
    const never = new Promise<never>(() => undefined);
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: History | null; hold: (on: boolean) => void; nudge: () => void } = {
      history: null,
      hold: () => undefined,
      nudge: () => undefined,
    };
    function Gate({ held }: { held: boolean }) {
      if (held) throw never;
      return null;
    }
    function App() {
      const [held, hold] = useState(false);
      const [, nudge] = useState(0);
      out.hold = hold;
      out.nudge = () => nudge((n) => n + 1);
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <Suspense fallback={null}>
          <Gate held={held} />
          <ChartContainer deps={deps} data={[]} plotRef={plotRef}>
            <ChartSeries series={LINE} data={history.data} />
            <InfiniteHistory history={history} />
          </ChartContainer>
        </Suspense>
      );
    }
    render(<App />);
    act(() => out.history?.reset(points(100, 120), { next: 'p2', fetchPage: a.fetchPage }));
    act(() =>
      startTransition(() => {
        out.hold(true);
        out.history?.reset(points(500, 520), { next: 'q2', fetchPage: b.fetchPage });
      }),
    );
    act(() => out.nudge());
    act(() => plotRef.current?.setVisibleRange(85, 110));
    await settle();

    expect(asked).toEqual(['A:p2']);
  });

  it('a fetch that resets history from inside its own call leaves no stale status', async () => {
    const { App, plot, history } = harness();
    render(<App />);
    let resetOnce = true;
    const fetch = (_before: number): Promise<LineDataPoint[]> => {
      if (resetOnce) {
        resetOnce = false;
        history().reset(points(500, 520), null);
      }
      return new Promise<LineDataPoint[]>(() => undefined);
    };
    act(() => history().reset(points(100, 120), { fetch }));
    // The loader goes loading after its fetch returned — the reset came first.
    act(() => plot().setVisibleRange(85, 110));
    await settle();

    expect(history().data).toEqual(points(500, 520));
    expect(history().status).toBeNull();
  });

  it("reads a new load's own status even with no chart mounted — not the last load's", async () => {
    const { fetchPage } = pagesByToken({ p2: { bars: points(80, 100), next: 'p3' } });
    const { App, plot, history } = harness();
    const view = render(<App />);
    act(() => history().reset(points(100, 120), { next: 'p2', fetchPage }));
    act(() => plot().setVisibleRange(95, 115));
    await settle();
    view.rerender(<App paging={false} />);

    act(() => history().reset(points(500, 520), { next: null, fetchPage }));
    expect(history().status).toBe('done');
  });

  /**
   * **A page for the load on screen doesn't ride a reset waiting in a
   * transition.** React replays the waiting reset and then every update
   * after it — the page's update has to know which load it was for.
   */
  it('drops a page of the load on screen when a reset waiting in a transition commits', async () => {
    let answer: (page: Page) => void = () => undefined;
    const late = (_token: string) =>
      new Promise<Page>((resolve) => {
        answer = resolve;
      });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let open = false;
    void gate.then(() => {
      open = true;
    });
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: History | null; hold: (on: boolean) => void } = { history: null, hold: () => undefined };
    function Gate({ held }: { held: boolean }) {
      if (held && !open) throw gate;
      return null;
    }
    function App() {
      const [held, hold] = useState(false);
      out.hold = hold;
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <Suspense fallback={null}>
          <Gate held={held} />
          <ChartContainer deps={deps} data={[]} plotRef={plotRef}>
            <ChartSeries series={LINE} data={history.data} />
            <InfiniteHistory history={history} />
          </ChartContainer>
        </Suspense>
      );
    }
    render(<App />);
    act(() => out.history?.reset(points(100, 120), { next: 'p2', fetchPage: late }));
    act(() => plotRef.current?.setVisibleRange(85, 110));
    act(() =>
      startTransition(() => {
        out.hold(true);
        out.history?.reset(points(500, 520), null);
      }),
    );
    answer({ bars: points(80, 100), next: null });
    await settle();
    await act(async () => {
      release();
      await gate;
    });
    await settle();

    expect(out.history?.data).toEqual(points(500, 520));
  });

  it('refuses a second chart paging the same load at once — one cursor, one loader', () => {
    const { fetchPage } = pagesByToken({});
    const deps = makeDeps();
    const out: { history: History | null } = { history: null };
    function App({ twice }: { twice: boolean }) {
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <>
          <ChartContainer deps={deps} data={[]}>
            <ChartSeries series={LINE} data={history.data} />
            <InfiniteHistory history={history} />
          </ChartContainer>
          {twice && (
            <ChartContainer deps={deps} data={[]}>
              <ChartSeries series={LINE} data={history.data} />
              <InfiniteHistory history={history} />
            </ChartContainer>
          )}
        </>
      );
    }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const view = render(<App twice={false} />);
      act(() => out.history?.reset(points(100, 120), { next: 'p2', fetchPage }));
      expect(() => view.rerender(<App twice />)).toThrow(/one <InfiniteHistory>/);
    } finally {
      quiet.mockRestore();
    }
  });

  /**
   * **An edit belongs to the load it was made on.** A live tick for the load
   * on screen, made while a reset waits in a transition, is replayed after
   * that reset by React — it must not land on the new load's bars.
   */
  it('drops an edit of the load on screen when a reset waiting in a transition commits', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let open = false;
    void gate.then(() => {
      open = true;
    });
    const deps = makeDeps();
    const out: { history: History | null; hold: (on: boolean) => void } = { history: null, hold: () => undefined };
    function Gate({ held }: { held: boolean }) {
      if (held && !open) throw gate;
      return null;
    }
    function App() {
      const [held, hold] = useState(false);
      out.hold = hold;
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <Suspense fallback={null}>
          <Gate held={held} />
          <ChartContainer deps={deps} data={[]}>
            <ChartSeries series={LINE} data={history.data} />
          </ChartContainer>
        </Suspense>
      );
    }
    render(<App />);
    act(() => out.history?.reset(points(100, 120), null));
    act(() =>
      startTransition(() => {
        out.hold(true);
        out.history?.reset(points(500, 520), null);
      }),
    );
    act(() => out.history?.setData((bars) => [...bars, { x: 120, y: 1 }]));
    await act(async () => {
      release();
      await gate;
    });
    await settle();

    expect(out.history?.data).toEqual(points(500, 520));
  });

  /**
   * **An edit can name its load.** A feed that resets and then hears its
   * first tick before React commits knows the load it's for — the handle
   * `reset` returns — and the edit lands on that load's bars.
   */
  it('lands an edit on the load it names — a tick right after its reset, before the commit', () => {
    const { App, history } = harness();
    render(<App />);
    act(() => {
      const load = history().reset(points(100, 120), null);
      history().setData((bars) => [...bars, { x: 120, y: 2 }], load);
    });

    expect(history().data).toEqual([...points(100, 120), { x: 120, y: 2 }]);
    expect(history().load).not.toBeNull();
  });

  it("lands an unnamed edit from a child's layout effect in the commit that brought its load", () => {
    const deps = makeDeps();
    const out: { history: History | null } = { history: null };
    function Ticker({ history }: { history: History }) {
      const { load, setData } = history;
      useLayoutEffect(() => {
        if (load) setData((bars) => [...bars, { x: 120, y: 2 }]);
      }, [load, setData]);
      return null;
    }
    function App() {
      const history = useInfiniteHistory<LineDataPoint, string>();
      out.history = history;
      return (
        <>
          <Ticker history={history} />
          <ChartContainer deps={deps} data={[]}>
            <ChartSeries series={LINE} data={history.data} />
          </ChartContainer>
        </>
      );
    }
    render(<App />);
    act(() => {
      out.history?.reset(points(100, 120), null);
    });

    expect(out.history?.data).toEqual([...points(100, 120), { x: 120, y: 2 }]);
  });
});
