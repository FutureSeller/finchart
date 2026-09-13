import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC, Series, SeriesHandle } from "@finchart/core";
import {
  areaSeries,
  barSeries,
  candleSeries,
  crosshair,
  lineSeries,
  OHLCAccessor,
  priceFormat,
  timeTicks,
} from "@finchart/core";
import { attachMovingAverage } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Switching chart types — swapSeries changes only the presentation";
export const description =
  "Move between candles · bars · line · area with the buttons. The data stays OHLC and only the way of drawing it changes, so the mounted MA(20) and the viewport both survive the switch. " +
  "Go out to line and back to candles and the highs and lows are intact — swapSeries swaps in the new series' decimation and accessor too.";

/** Background for the pressed button — the case stands on its own without the shell's CSS. */
function paintPressed(el: HTMLButtonElement, pressed: boolean): void {
  el.style.background = pressed ? "#3b82f6" : "";
  el.style.color = pressed ? "#fff" : "";
}

type ChartType = "candle" | "bar" | "line" | "area";
const CHART_TYPES: readonly ChartType[] = ["candle", "bar", "line", "area"];
const LABELS: Record<ChartType, string> = {
  candle: "Candles",
  bar: "Bars",
  line: "Line",
  area: "Area",
};

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Chart type");
  toolbar.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap";
  container.append(toolbar);
  const host = chartHost(container, 480);

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  /**
   * The list of types — all four draw the **same OHLC data**. Line and area
   * are handed an `OHLCAccessor` (`{ coordinates }`) rather than the default
   * accessor (which reads `y`), so they read the close. Candles and bars come with their own
   * accessor by default, so the factory is enough.
   */
  const chartTypes: Record<ChartType, Series<OHLC>> = {
    candle: candleSeries(),
    bar: barSeries(),
    line: lineSeries({ coordinates: new OHLCAccessor() }),
    area: areaSeries({ coordinates: new OHLCAccessor() }),
  };

  const price: SeriesHandle<OHLC> = plot.mainPane.addSeries({
    series: chartTypes.candle,
    data: fixtureCandles(),
    name: "Price",
  });

  // The witness that only the presentation changes — swap the type and this MA
  // stays put, with no re-registration.
  plot.mainPane.use(attachMovingAverage({ source: price, period: 20, color: "#f59e0b" }));

  plot.use(crosshair({ magnet: true }));

  const buttons = new Map<ChartType, HTMLButtonElement>();
  const select = (next: ChartType): void => {
    // swapSeries leaves the data, the viewport, and the derived series alone
    // and changes only the way of drawing. Decimation and the accessor follow
    // the new series — that's why the highs and lows aren't erased coming back
    // from line (four points per pixel column) to candles (candle aggregation).
    price.swapSeries(chartTypes[next]);
    for (const [type, el] of buttons) {
      el.setAttribute("aria-pressed", String(type === next));
      paintPressed(el, type === next);
    }
  };

  for (const type of CHART_TYPES) {
    const el = document.createElement("button");
    el.textContent = LABELS[type];
    el.setAttribute("aria-pressed", String(type === "candle"));
    paintPressed(el, type === "candle");
    el.addEventListener("click", () => select(type));
    buttons.set(type, el);
    toolbar.append(el);
  }

  return Object.assign(
    () => {
      plot.destroy();
      toolbar.remove();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
