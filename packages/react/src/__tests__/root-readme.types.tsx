/**
 * **The root README's React example compiles here.**
 *
 * This example had no machine guarding it, and so it wasn't merely stale —
 * it **never compiled in the first place**. The derive function's body was
 * the pseudocode `/* source → points *\/ points;`, and `points` didn't exist
 * anywhere. A consumer who copy-pasted it would see `TS2304: Cannot find
 * name 'points'` on the very first line.
 *
 * The vanilla 60-second example is guarded by
 * `apps/docs/snippets/getting-started.ts`, and the package README's
 * 60-second example by `minimal-service.types.tsx`. **Of the three front
 * doors, React was the only one left undefended** — that asymmetry is why
 * this file exists.
 *
 * (Since the file isn't `.test.tsx`, vitest ignores it and only `tsc` looks
 * at it.)
 */

import type { LineDataPoint, OHLC } from '@finchart/core';
import { candleSeries, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { useMemo } from 'react';
import { ChartContainer, ChartPane, ChartSeries, XAxis, YAxis } from '../components';

/**
 * The first 19 values being `null` is half of what this example
 * demonstrates — omitting a point makes the line span across the gap
 * — that is `null`'s whole reason for existing on `LineDataPoint.y`.
 */
const movingAverage20 = (source: OHLC[]): LineDataPoint[] =>
  source.map((bar, i) => ({
    x: bar.x,
    y:
      i < 19
        ? null
        : source.slice(i - 19, i + 1).reduce((sum, b) => sum + b.close, 0) / 20,
  }));

export function Chart({ data }: { data: OHLC[] }) {
  // The reference doesn't need to be stable — identity comes from the JSX
  // position, and deriveKey decides whether to recompute. deps is read only
  // once, at mount.
  const deps = useMemo(() => browserDeps(), []);
  const price = candleSeries();
  const ma = lineSeries({ line: { color: '#f59e0b' } });

  return (
    <ChartContainer deps={deps} data={data} width={800} height={400}>
      <XAxis />
      <ChartPane>
        <YAxis />
        <ChartSeries series={price} />
        {/* Overlaid on the price series. deriveKey is what tells it when to recompute */}
        <ChartSeries series={ma} derive={movingAverage20} deriveKey={[20]} />
      </ChartPane>
    </ChartContainer>
  );
}
