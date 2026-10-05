import type { OHLC, Pane, Plot, Source } from "@finchart/core";
import { histogramSeries, priceFormat } from "@finchart/core";
import { bandSeries, bollingerBands, macd, movingAverage, rsi } from "@finchart/indicators";
import { drawingTools, type DrawingToolsApi } from "@finchart/tools";
import { ChartLine, ChartPane, ChartSeries, Plugin, PriceLine, YAxis } from "@finchart/react";
import { useMemo } from "react";

const RSI_FORMAT = priceFormat({ precision: 0, locale: "en-US" });
const MACD_FORMAT = priceFormat({ precision: 2, locale: "en-US" });
const RSI_DOMAIN: readonly [number, number] = [0, 100];
const MACD_HISTOGRAM = histogramSeries();
const BOLL_BAND = bandSeries();
const OVERLAY_LINE = { point: { radius: 0 } };

/** MA and BOLL ride the price pane — one computation node each, read through `input`. */
export function Overlays({ source, ma, maPeriod, boll }: { source: Source<OHLC>; ma: boolean; maPeriod: number; boll: boolean }) {
  // The reference is the identity: a period change rebuilds the MA node alone.
  // Built only while it's on — a period is the user's to type, and an MA nobody
  // shows must not cost what that period says.
  const maNode = useMemo(() => (ma ? movingAverage(source, { period: maPeriod }) : null), [ma, source, maPeriod]);
  const bollNode = useMemo(() => bollingerBands(source), [source]);
  return (
    <>
      {boll && (
        <>
          <ChartSeries series={BOLL_BAND} input={bollNode.out.band} name="BOLL" />
          <ChartLine input={bollNode.out.middle} readout={false} style={{ line: { color: "#8b5cf6", width: 1 }, ...OVERLAY_LINE }} />
        </>
      )}
      {maNode && <ChartLine name={`MA${maPeriod}`} input={maNode.out.ma} style={{ line: { color: "#3b82f6", width: 1.5 }, ...OVERLAY_LINE }} />}
    </>
  );
}

/**
 * RSI on its own pane, fixed at 0–100 with its 70/30 guides, and a toolbox
 * of its own. A period change swaps the line only — the pane, its place in
 * the stack, its drawings and its height stay.
 */
export function RsiPane({ source, period, onTools }: { source: Source<OHLC>; period: number; onTools: (tools: DrawingToolsApi | null) => void }) {
  const node = useMemo(() => rsi(source, { period }), [source, period]);
  return (
    <ChartPane flex={0.35} minHeight={60} valueDomain={RSI_DOMAIN}>
      {/* 0–100, not a price — the chart-wide price format (won, or cents) doesn't apply. */}
      <YAxis format={RSI_FORMAT} />
      <ChartLine input={node.out.rsi} name={`RSI${period}`} style={{ line: { color: "#f59e0b", width: 1.5 }, ...OVERLAY_LINE }} />
      <PriceLine value={70} />
      <PriceLine value={30} />
      <Plugin install={drawingToolsOn} onApi={onTools} />
    </ChartPane>
  );
}

export function MacdPane({ source }: { source: Source<OHLC> }) {
  const node = useMemo(() => macd(source), [source]);
  return (
    <ChartPane flex={0.35} minHeight={60}>
      <YAxis format={MACD_FORMAT} />
      <ChartSeries series={MACD_HISTOGRAM} input={node.out.histogram} name="MACD hist" />
      <ChartLine input={node.out.macd} name="MACD" style={{ line: { color: "#3b82f6", width: 1.5 }, ...OVERLAY_LINE }} />
      <ChartLine input={node.out.signal} name="Signal" style={{ line: { color: "#f97316", width: 1.5 }, ...OVERLAY_LINE }} />
    </ChartPane>
  );
}

export const drawingToolsOn = (plot: Plot, pane: Pane) => pane.use(drawingTools({ plot }));
