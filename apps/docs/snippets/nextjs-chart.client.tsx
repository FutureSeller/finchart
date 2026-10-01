"use client";

import { candleSeries, timeTicks } from "@finchart/core";
import type { OHLC } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { ChartContainer, ChartSeries, XAxis, YAxis } from "@finchart/react";

// The wiring lives in this client file: `browserDeps()` returns a function
// (container in, collaborators out), and a function cannot cross the
// server–client boundary as a prop. Module scope, `useMemo`, or an inline
// call all read the same — `deps` is taken once, when the chart mounts — as
// long as the wiring is fixed and pure.
const deps = browserDeps({ autoSize: true });
// Bars keyed by epoch ms read as dates only through a time strategy — the
// default axis labels plain numbers. Module scope keeps it one object, so
// the axis isn't re-applied on every render.
const ticks = timeTicks();

/** Rendered from a Server Component with plain data: `<PriceChart bars={bars} />`. */
export function PriceChart({ bars }: { bars: OHLC[] }) {
  return (
    <ChartContainer deps={deps} data={bars} height={400}>
      <ChartSeries series={candleSeries()} />
      <XAxis ticks={ticks} />
      <YAxis />
    </ChartContainer>
  );
}
