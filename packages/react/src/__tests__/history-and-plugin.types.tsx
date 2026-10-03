/**
 * Type locks for history and plugin installs — the snippets the README,
 * the TSDoc and the infinite-history page show, compiled, and the paging
 * union kept either/or.
 *
 * (Not `.test.tsx`: vitest ignores it and only `tsc` looks at it.)
 */
import type { OHLC, Plot, Plugin as CorePlugin, PluginApi, SeriesHost } from '@finchart/core';
import { OHLCAccessor, paneMaximize } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { useEffect, useState } from 'react';
// Through the public entry point — a name dropped from it fails here.
import { ChartCandles, ChartContainer, ChartPane, InfiniteHistory, Plugin, useInfiniteHistory } from '../index';

declare const api: {
  candles(symbol: string, cursor?: string): Promise<{ bars: OHLC[]; next: string | null }>;
};

/** `@finchart/tools` isn't a dependency here — a stand-in of its shape. */
interface DrawingToolsApi extends PluginApi {
  begin(kind: 'trend'): void;
}
declare function drawingTools(options: { plot: Plot }): CorePlugin<SeriesHost, DrawingToolsApi>;

const CANDLES = new OHLCAccessor();
const deps = browserDeps();

/** The infinite-history page and `useInfiniteHistory`'s TSDoc. */
export function History({ symbol }: { symbol: string }) {
  const history = useInfiniteHistory<OHLC, string>({ coordinates: CANDLES });
  const { reset } = history;
  useEffect(() => {
    let current = true;
    api.candles(symbol).then((page) => {
      if (!current) return;
      reset(page.bars, {
        next: page.next,
        fetchPage: (cursor) => api.candles(symbol, cursor),
      });
    });
    return () => {
      current = false;
    };
  }, [symbol, reset]);

  return (
    <ChartContainer deps={deps} data={history.data}>
      <ChartCandles />
      <InfiniteHistory history={history} />
    </ChartContainer>
  );
}

/** The README's `<Plugin>` lane. */
export function Tools({ bars }: { bars: OHLC[] }) {
  const [tools, setTools] = useState<DrawingToolsApi | null>(null);
  return (
    <>
      <ChartContainer deps={deps} data={bars}>
        <Plugin install={(plot) => plot.use(paneMaximize({ gestures: true }))} />
        <ChartPane>
          <Plugin<DrawingToolsApi> install={(plot, pane) => pane.use(drawingTools({ plot }))} onApi={setTools} />
        </ChartPane>
      </ChartContainer>
      <button type="button" onClick={() => tools?.begin('trend')}>
        Trend
      </button>
    </>
  );
}

/** Paging is by time or by token — never both, and a history reads only its own values. */
export function Paging() {
  const history = useInfiniteHistory<OHLC, string>();
  const byTime = (before: number): OHLC[] => [{ x: before - 1, open: 1, high: 1, low: 1, close: 1 }];
  const byToken = (cursor: string) => api.candles('A', cursor);

  history.reset([], { fetch: byTime });
  history.reset([], { next: 'p2', fetchPage: byToken });
  history.reset([], null);
  // @ts-expect-error — a load pages by time or by token, not both
  history.reset([], { fetch: byTime, next: 'p2', fetchPage: byToken });
  // @ts-expect-error — the token's type is the history's
  history.reset([], { next: 7, fetchPage: byToken });
  // @ts-expect-error — a history value carries its link; a bare object is not one
  return <InfiniteHistory history={{ data: [] }} />;
}
