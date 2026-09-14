import { histogramSeries, priceFormat } from "@finchart/core";
import type { HistogramPoint, OHLC } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { ChartCandles, ChartContainer, ChartPane, ChartSeries, YAxis } from "@finchart/react";

const deps = browserDeps({ autoSize: true });

// Built once, outside render: a new function each render would be a new
// format for the axis to apply.
const PRICE_FORMATS = {
  KRW: priceFormat({ precision: 0, locale: "ko-KR" }),
  USD: priceFormat({ precision: 2, locale: "ko-KR" }),
};
const VOLUME_FORMAT = priceFormat({ compact: true, locale: "ko-KR" });

export function Chart({ bars, currency }: { bars: OHLC[]; currency: "KRW" | "USD" }) {
  const volumes = bars.map<HistogramPoint>((bar) => ({ x: bar.x, y: bar.volume ?? null }));
  return (
    <ChartContainer deps={deps} data={bars} height={600}>
      {/* Outside every pane: the default for all of them. */}
      <YAxis position="right" format={PRICE_FORMATS[currency]} />
      <ChartPane>
        <ChartCandles name="Price" />
      </ChartPane>
      <ChartPane flex={0.35}>
        {/* Inside a pane: that pane only. */}
        <YAxis format={VOLUME_FORMAT} />
        <ChartSeries series={histogramSeries()} data={volumes} name="Volume" />
      </ChartPane>
    </ChartContainer>
  );
}
