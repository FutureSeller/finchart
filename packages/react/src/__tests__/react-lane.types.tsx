/**
 * Type locks for the react lane round.
 *
 * - `options` is `PlotOptionsPatch` minus the keys that have a door of their
 *   own (`axis` → `<XAxis>/<YAxis>`, `style.grid` → `gridStyle`, `showGrid`,
 *   `paneGap`). Two doors to one value erase each other — the axis proved it.
 *   For the same reason `<ChartPane>` takes no `axis`; `<YAxis>` owns it.
 * - `<ChartLine>`/`<ChartCandles>` take the imperative lane's override shape
 *   through `style`; the flat mirror props are gone.
 * - A `SeriesHandle` is a `Source`, so it hands straight to anything that
 *   takes one.
 */
import type { LineDataPoint, OHLC, SeriesHandle, Source } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { ChartCandles, ChartContainer, ChartLine, ChartPane } from '../components';

const deps = browserDeps();
const data: LineDataPoint[] = [];

export const allowed = (
  <ChartContainer
    deps={deps}
    data={data}
    options={{
      padding: { left: 4 },
      resizablePanes: false,
      shiftVisibleRangeOnNewBar: true,
      axisDrag: false,
      rightOffset: 5,
      minBarSpacing: 2,
      maxBarSpacing: null,
    }}
  />
);

export const axisHasItsOwnDoor = (
  // @ts-expect-error axis is `<XAxis>`/`<YAxis>`'s
  <ChartContainer deps={deps} data={data} options={{ axis: { x: {} } }} />
);
export const showGridIsAProp = (
  // @ts-expect-error showGrid has a prop
  <ChartContainer deps={deps} data={data} options={{ showGrid: false }} />
);
export const paneGapIsAProp = (
  // @ts-expect-error paneGap has a prop
  <ChartContainer deps={deps} data={data} options={{ paneGap: 4 }} />
);
export const paneAxisHasItsOwnDoor = (
  <ChartContainer deps={deps} data={data}>
    {/* @ts-expect-error a pane's value axis is `<YAxis>`'s — a second door would erase it */}
    <ChartPane axis={{ showLabels: false }} />
  </ChartContainer>
);
export const gridStyleIsAProp = (
  // @ts-expect-error style.grid is `gridStyle`
  <ChartContainer deps={deps} data={data} options={{ style: { grid: {} } }} />
);

export const styledLine = (
  <ChartLine data={data} style={{ line: { color: 'red', width: 1, dashArray: '4 2' }, point: { radius: 0 } }} />
);
export const styledCandles = <ChartCandles style={{ up: '#0f0', down: '#f00', wickWidth: 1, bodyRatio: 0.5 }} />;

// @ts-expect-error the flat mirror is gone — say `style={{ point: { radius: 0 } }}`
export const flatLine = <ChartLine data={data} pointRadius={0} />;
// @ts-expect-error the flat mirror is gone — say `style={{ up }}`
export const flatCandles = <ChartCandles up="#0f0" />;
// @ts-expect-error `color` was the swatch and the stroke — now `style.line.color`
export const flatLineColor = <ChartLine data={data} color="red" />;
// @ts-expect-error `down` is `style.down`
export const flatCandlesDown = <ChartCandles down="#f00" />;

export function handleIsASource(handle: SeriesHandle<OHLC>): Source<OHLC> {
  return handle;
}
