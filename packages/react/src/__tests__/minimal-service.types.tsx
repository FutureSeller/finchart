/**
 * **The README's 60-second example compiles here.**
 *
 * A doc's example is just a string, so it goes stale silently as the API
 * grows — `magnet` and `position` had actually dropped out that way. So the
 * minimal program for "one production-shaped chart" lives here, and `tsc`
 * guards it. Change the README and this file has to change with it; fail to
 * and the build breaks.
 *
 * (Since the file isn't `.test.tsx`, vitest ignores it and only `tsc` looks
 * at it.)
 */

import type { DataView, LineDataPoint, OHLC } from '@finchart/core';
import { histogramSeries, timeTicks, type HistogramPoint } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import {
  ChartCandles,
  ChartContainer,
  ChartLine,
  ChartPane,
  ChartSeries,
  Crosshair,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from '../components';

declare const bars: OHLC[];
declare const volume: HistogramPoint[];

/**
 * **This is not a place to erase with `declare`.**
 *
 * It used to be `declare const ma: LineDataPoint[]` — the JSX was guarded,
 * but exactly where consumers got stuck was "so where do I get `ma` from,"
 * and the machine's coverage fell short of the README's promise ("this
 * example is machine-guarded"). Data (`bars`, `volume`) is fair game for
 * `declare` since the consumer brings it, but the derive is **knowledge the
 * example has to teach**.
 *
 * The first 19 values being `null` is half of what this example
 * demonstrates — omitting a point makes the line span across the gap
 * (the comment on `LineDataPoint.y` cites exactly this case as null's
 * reason for existing).
 */
const sma20 = (source: DataView<OHLC>): LineDataPoint[] =>
  source.map((bar, i) => ({
    x: bar.x,
    y:
      i < 19
        ? null
        : source.slice(i - 19, i + 1).reduce((sum, b) => sum + b.close, 0) / 20,
  }));

/**
 * One production-shaped chart — candles + a volume pane + a moving average
 * + crosshair/tooltip/legend + live updates + responsive sizing.
 *
 * **Zero hooks, one line of wiring**: live updates just means handing
 * `data` a new array, and `flex` decides pane height. The wiring is
 * **explicitness as contract** — that one line decides what ends up in the
 * bundle.
 */
const deps = browserDeps({ autoSize: true });

export const minimalService = (
  <ChartContainer deps={deps} data={bars} style={{ height: 480 }}>
    <XAxis ticks={timeTicks()} />
    <YAxis position="right" />

    <Crosshair magnet />
    <Tooltip />
    <Legend />

    <ChartPane>
      <ChartCandles name="Price" />
      <ChartLine
        derive={sma20}
        deriveKey={[20]}
        color="#f59e0b"
        width={1.5}
        pointRadius={0}
      />
    </ChartPane>

    <ChartPane flex={0.25} minHeight={48}>
      <ChartSeries series={histogramSeries()} data={volume} name="Volume" />
    </ChartPane>
  </ChartContainer>
);

/**
 * `MarkersProps` — the one component props type that used to be anonymous.
 * The wrapper around `<Markers>` couldn't name its own props type.
 */
import type { MarkersProps } from '../components';
export const markerProps: MarkersProps = { items: [] };

/** Its three siblings must be nameable too. */
import type { PriceLineProps, SpanProps, WatermarkProps } from '../components';
export const decoProps: [PriceLineProps, SpanProps, WatermarkProps] = [
  { value: 105 },
  { from: 0, to: 10 },
  { text: 'AAPL' },
];
