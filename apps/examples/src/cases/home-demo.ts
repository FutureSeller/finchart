/**
 * The demo for the docs site's homepage — the wiring is the same as
 * candles-volume, except:
 * - Bars are generated as a pure function of the index, so they can be
 *   extended deterministically backwards too (to show infinite scroll through
 *   prepend).
 * - Pan near the left edge and it really does fetch older bars —
 *   through `infiniteHistory`, whose page here is a synchronous generator.
 * - `minBarSpacing` puts a floor under zooming out so the candles never get
 *   too thin.
 *
 * It isn't listed in the gallery — title/description are here only to satisfy
 * the CaseModule contract.
 */
import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { HistogramPoint, OHLC } from "@finchart/core";
import { candleSeries, crosshair, histogramSeries, infiniteHistory, timeTicks } from "@finchart/core";
import { chartHost } from "./stage";

export const title = "Candles + volume (home)";
export const description = "For the homepage hero — a candles-volume variant with infinite history loading and a zoom-out floor.";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 7, 10, 9, 0);
const CHUNK = 70; // how many bars show at first, and how many older bars a fetch brings
const MAX_HISTORY = 4000; // the backstop on infinite loading — nothing older than this index gets made

/** Deterministic pseudo-random in [0,1) — one index, always the same value. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

/** Trend + noise. A function of the index alone, so negative (past) indices carry straight on. */
function priceAt(index: number): number {
  const drift = Math.sin(index / 23) * 900 + Math.sin(index / 71) * 1400 + index * 0.6;
  const jitter = (noise(index) - 0.5) * 2800;
  return Math.max(1_000, 50_000 + drift + jitter);
}

function ohlcAt(index: number): OHLC {
  const open = priceAt(index - 1);
  const close = priceAt(index);
  const spread = noise(index * 7 + 3) * 900 + 120;
  const volume = Math.round(100 + noise(index * 13 + 1) * 400);
  return {
    x: BASE + index * MINUTE,
    open,
    close,
    high: Math.max(open, close) + spread,
    low: Math.min(open, close) - spread,
    volume,
  };
}

function toVolumePoint(candle: OHLC): HistogramPoint {
  return {
    x: candle.x,
    y: candle.volume ?? null,
    color: candle.close >= candle.open ? "rgba(22, 163, 74, 0.45)" : "rgba(220, 38, 38, 0.45)",
  };
}

function range(from: number, to: number): OHLC[] {
  const out: OHLC[] = [];
  for (let i = from; i < to; i++) out.push(ohlcAt(i));
  return out;
}

// `timeTicks()` takes care of the tick (grid) labels only — what the crosshair
// badge and the tooltip read is a separate `axis.x.format`. Leave it out and
// the raw epoch ms number shows up as it is (core has no formatter paired with
// timeTicks yet).
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
});

// priceFormat() doesn't attach a currency symbol (it takes only locale,
// compact, and precision) — if you need a "$", reach for Intl.NumberFormat's
// style:"currency" directly.
const priceFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
// The y-axis format is the default for the whole Plot, so every pane inherits
// it — give the volume pane none of its own and the price's "$" leaks straight
// through, and a volume of 500 reads "$500".
const volumeFmt = new Intl.NumberFormat("en-US");

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 420);
  const width = container.clientWidth || 900;
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(width, 420)
    .setAxis({
      x: {
        ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }),
        format: (x) => timeFormat.format(x),
      },
      y: { position: "right", format: (v) => priceFmt.format(v) },
    })
    .build(host);

  // min/maxBarSpacing is not "pixels per bar" but "pixels per one unit of the
  // domain" — under bar-index coordinates (barIndexX) 1 unit = 1 bar, so the
  // two happen to coincide, but this is a continuous coordinate system
  // (1 unit = 1ms), so pixels per bar have to be divided by MINUTE to convert
  // to pixels per ms. Skip that and either neither limit really binds
  // (unlimited zoom in) or both land far above the current span and nail the
  // view in place (no zooming out).
  const pxPerCandle = width / CHUNK;
  plot.applyOptions({
    maxBarSpacing: pxPerCandle / MINUTE, // can't zoom in past the initial span
    minBarSpacing: pxPerCandle / 2 / MINUTE, // zooming out is allowed only to half
  });

  const initial = range(-CHUNK, 0);

  const priceHandle = plot.mainPane.addSeries({
    series: candleSeries(),
    data: initial,
    name: "Price",
  });
  const volumeHandle = plot
    .addPane({ flex: 0.3, minHeight: 60, axis: { format: (v) => volumeFmt.format(v) } })
    .addSeries({
      series: histogramSeries(),
      data: initial.map(toVolumePoint),
      name: "Volume",
    });

  /**
   * The infinite scroll. The consumer's share is two functions — the page
   * before a given x, and where a landed page goes (one fetch, fanned out
   * to both handles). The cursor, the threshold, in-flight dedup, and the
   * empty-page end (`[]` once the backstop is reached) are the loader's.
   */
  const loader = infiniteHistory(
    plot,
    (older: OHLC[]) => {
      priceHandle.prepend(older);
      volumeHandle.prepend(older.map(toVolumePoint));
    },
    (before) => {
      const end = Math.round((before - BASE) / MINUTE);
      const from = Math.max(end - CHUNK, -MAX_HISTORY);
      return from >= end ? [] : range(from, end);
    },
    { from: initial[0].x },
  );

  plot.use(crosshair({ magnet: true }));

  return Object.assign(
    () => {
      loader.dispose();
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
