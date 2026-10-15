/**
 * **The root README's React example compiles here.**
 *
 * An example no machine guards need not compile at all, and a consumer who
 * copy-pastes it meets the error on the first line. `snippet-drift.test.ts`
 * holds the README's text to this copy, so editing either side alone fails.
 *
 * The vanilla quick start is guarded the same way by
 * `apps/docs/snippets/getting-started.ts`, and the package README's example
 * by `minimal-service.types.tsx`. This file guards the third front door,
 * React.
 *
 * (Since the file isn't `.test.tsx`, vitest ignores it and only `tsc` looks
 * at it.)
 */

import type { OHLC } from '@finchart/core';
import { candleSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { useMemo } from 'react';
import { ChartContainer, ChartPane, ChartSeries, XAxis, YAxis } from '../components';

export function Chart({ data }: { data: OHLC[] }) {
  const deps = useMemo(() => browserDeps(), []);
  return (
    <ChartContainer deps={deps} data={data} width={800} height={400}>
      <XAxis />
      <ChartPane>
        <YAxis />
        <ChartSeries series={candleSeries()} />
      </ChartPane>
    </ChartContainer>
  );
}
