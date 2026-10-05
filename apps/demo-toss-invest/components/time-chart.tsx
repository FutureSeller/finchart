import type { HistogramPoint, OHLC, Plot } from "@finchart/core";
import { AreaSeries, barIndexX, candleSeries, histogramSeries, LineSeries, LogScale, OHLCAccessor, paneMaximize, priceFormat, timeTicks } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { ChartContainer, ChartPane, ChartSeries, Crosshair, InfiniteHistory, Plugin, Tooltip, useDataSource, XAxis, YAxis, type PlotOptions } from "@finchart/react";
import { useMemo } from "react";
import { marketTimeZone, timeLabel, type Interval } from "../lib/candles";
import type { ChartView, ChartKind } from "../lib/chart-view";
import type { MarketDataState } from "../hooks/use-market-data";
import type { ChartSession } from "../hooks/use-chart-session";
import { Overlays, RsiPane, MacdPane, drawingToolsOn } from "./indicator-panes";

// Bar-index spacing closes overnight/weekend gaps while data and cursors keep ms x.
// The modifier wheel leaves normal page scrolling available.
const DEPS = browserDeps({ autoSize: true, createXMapping: barIndexX, pointer: { wheel: "modifier" } });
const LIVE_OPTIONS: PlotOptions = { shiftVisibleRangeOnNewBar: true, rightOffset: 5, preserveLiveRightEdgeOnZoomOut: true };
const VOLUME = histogramSeries();
const VOLUME_FORMAT = priceFormat({ compact: true, locale: "en-US" });
const LOG_SCALE = () => new LogScale();
const COORDINATES = new OHLCAccessor();
const maximizeOn = (plot: Plot) => plot.use(paneMaximize({ gestures: true }));

// Stable representations switch presentation while retaining data and derivation caches.
const PRICE_SERIES: Record<ChartKind, ReturnType<typeof candleSeries> | LineSeries<OHLC> | AreaSeries<OHLC>> = {
  candle: candleSeries(),
  line: new LineSeries<OHLC>({ coordinates: COORDINATES, style: { point: { radius: 0 } } }),
  area: new AreaSeries<OHLC>({ coordinates: COORDINATES }),
};
const volumeOf = (bar: OHLC): HistogramPoint => ({ x: bar.x, y: bar.volume ?? null, tone: bar.close >= bar.open ? "up" : "down" });

export function TimeChart({ market, session, view, symbol, interval }: {
  market: MarketDataState;
  session: ChartSession;
  view: ChartView;
  symbol: string;
  interval: Interval;
}) {
  const { bars, history, result } = market;
  const { plotRef, chartElement, onPriceTools, onRsiTools, restoreTimeWindow } = session;
  const { kind: chartKind, indicators, periods, log } = view;
  const source = useDataSource(bars);
  const volume = useMemo(() => bars.map(volumeOf), [bars]);
  const currency = result?.candles[0]?.currency ?? "KRW";
  const timeZone = marketTimeZone(currency);
  const ticks = useMemo(() => timeTicks({ timeZone, locale: "en-US" }), [timeZone]);
  const formatX = useMemo(() => timeLabel(interval, timeZone), [interval, timeZone]);
  const formatPrice = useMemo(() => priceFormat({ precision: currency === "USD" ? 2 : 0, locale: "en-US" }), [currency]);
  return (
    <ChartContainer
      deps={DEPS}
      data={bars}
      options={LIVE_OPTIONS}
      onError={session.onRefused}
      plotRef={plotRef}
      onXDomainChange={restoreTimeWindow}
      containerRef={chartElement}
      style={{ height: 520 }}
    >
      <XAxis ticks={ticks} format={formatX} />
      <YAxis position="right" format={formatPrice} />
      <Crosshair magnet />
      <Tooltip formatX={formatX} />
      <InfiniteHistory history={history} />
      {/* Outside any <ChartPane>, so the price toolbox lands on mainPane. */}
      <Plugin install={drawingToolsOn} onApi={onPriceTools} />
      <Plugin install={maximizeOn} />

      {/* The first pane is mainPane; the log toggle swaps its scale in place. */}
      <ChartPane flex={3} yScale={log ? LOG_SCALE : undefined}>
        <ChartSeries series={PRICE_SERIES[chartKind]} name={symbol} />
        <Overlays source={source} ma={indicators.has("MA20")} maPeriod={periods.ma} boll={indicators.has("BOLL")} />
      </ChartPane>
      <ChartPane flex={1} minHeight={72}>
        {/* The price format on the outer <YAxis> is the chart-wide default; volume reads short. */}
        <YAxis format={VOLUME_FORMAT} />
        <ChartSeries series={VOLUME} data={volume} name="Volume" />
      </ChartPane>

      {/* Own-pane indicators go last, below volume. */}
      {indicators.has("RSI") && <RsiPane source={source} period={periods.rsi} onTools={onRsiTools} />}
      {indicators.has("MACD") && <MacdPane source={source} />}
    </ChartContainer>
  );
}
