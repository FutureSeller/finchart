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
 * page for a load `reset` replaced is dropped; an end stays an end; the
 * status is state.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { immediateScheduler, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartSeries, InfiniteHistory } from '../components';
import { useInfiniteHistory, type CursorHistory, type XHistory } from '../hooks/use-infinite-history';
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

/** Serves pages by token; records each token asked. */
function pagesByToken(book: Record<string, Page>) {
  const asked: string[] = [];
  const fetchPage = (token: string): Promise<Page> => {
    asked.push(token);
    return Promise.resolve(book[token] ?? { bars: [], next: null });
  };
  return { asked, fetchPage };
}

function cursorApp(fetchPage: (token: string) => Promise<Page>) {
  const deps = makeDeps();
  const plotRef = createRef<Plot>();
  const out: { history: CursorHistory<LineDataPoint, string> | null } = { history: null };

  function App({ chartKey }: { chartKey: string }) {
    const history = useInfiniteHistory<LineDataPoint, string>({ fetchPage });
    out.history = history;
    return (
      <ChartContainer key={chartKey} deps={deps} data={[]} plotRef={plotRef}>
        <ChartSeries series={LINE} data={history.data} />
        <InfiniteHistory history={history} />
      </ChartContainer>
    );
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
    const { App, plot, history } = cursorApp(fetchPage);
    render(<App chartKey="a" />);
    expect(history().status).toBeNull();

    act(() => history().reset(points(100, 120), 'p2'));
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
    const { App, plot, history } = cursorApp(fetchPage);
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), 'p2'));
    act(() => plot().setVisibleRange(95, 115));
    await settle();
    expect(asked).toEqual(['p2']);

    view.rerender(<App chartKey="b" />);
    act(() => plot().setVisibleRange(65, 90));
    await settle();

    expect(asked).toEqual(['p2', 'p3']);
    expect(history().data).toEqual(points(60, 120));
  });

  it('an end stays an end across a remount', async () => {
    const { asked, fetchPage } = pagesByToken({ p2: { bars: points(80, 100), next: null } });
    const { App, plot, history } = cursorApp(fetchPage);
    const view = render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), 'p2'));
    act(() => plot().setVisibleRange(85, 110));
    await settle();
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
    const { App, plot, history } = cursorApp(late);
    render(<App chartKey="a" />);
    act(() => history().reset(points(100, 120), 'p2'));
    act(() => plot().setVisibleRange(85, 110));

    act(() => history().reset(points(500, 520), null));
    answer({ bars: points(80, 100), next: null });
    await settle();

    expect(history().data).toEqual(points(500, 520));
    expect(history().status).toBe('done');
  });

  it('pages by time in x mode, resuming from the first bar held', async () => {
    const asked: number[] = [];
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: XHistory<LineDataPoint> | null } = { history: null };
    function App({ chartKey }: { chartKey: string }) {
      const history = useInfiniteHistory<LineDataPoint>({
        fetch: (before) => {
          asked.push(before);
          return before > 60 ? points(before - 20, before) : [];
        },
      });
      out.history = history;
      return (
        <StrictMode>
          <ChartContainer key={chartKey} deps={deps} data={[]} plotRef={plotRef}>
            <ChartSeries series={LINE} data={history.data} />
            <InfiniteHistory history={history} />
          </ChartContainer>
        </StrictMode>
      );
    }
    const view = render(<App chartKey="a" />);
    act(() => out.history?.reset(points(100, 120)));
    act(() => plotRef.current?.setVisibleRange(95, 115));
    await settle();
    expect(asked).toEqual([100]);

    view.rerender(<App chartKey="b" />);
    act(() => plotRef.current?.setVisibleRange(65, 95));
    await settle();

    expect(asked).toEqual([100, 80]);
    expect(out.history?.data).toEqual(points(60, 120));
  });

  it('an end by time stays an end across a remount — the empty page is not asked again', async () => {
    const asked: number[] = [];
    const deps = makeDeps();
    const plotRef = createRef<Plot>();
    const out: { history: XHistory<LineDataPoint> | null } = { history: null };
    function App({ chartKey }: { chartKey: string }) {
      const history = useInfiniteHistory<LineDataPoint>({
        fetch: (before) => {
          asked.push(before);
          return [];
        },
      });
      out.history = history;
      return (
        <ChartContainer key={chartKey} deps={deps} data={[]} plotRef={plotRef}>
          <ChartSeries series={LINE} data={history.data} />
          <InfiniteHistory history={history} />
        </ChartContainer>
      );
    }
    const view = render(<App chartKey="a" />);
    act(() => out.history?.reset(points(100, 120)));
    act(() => plotRef.current?.setVisibleRange(90, 110));
    await settle();
    expect(out.history?.status).toBe('done');

    view.rerender(<App chartKey="b" />);
    act(() => plotRef.current?.setVisibleRange(80, 100));
    await settle();

    expect(asked).toEqual([100]);
    expect(out.history?.status).toBe('done');
  });
});

