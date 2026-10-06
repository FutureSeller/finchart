/**
 * Infinite history through the `infiniteHistory` door.
 *
 * The consumer's whole job is two functions: a fetch that produces the page
 * of bars before a given x (here: generated, behind a simulated 250ms round
 * trip), and a sink that says where a landed page goes (here: fanned out to
 * the candle and volume handles — one fetch, two deliveries). The cursor,
 * the threshold test, in-flight dedup, boundary trimming, and the chaining
 * that keeps filling while the view sits past the data are the loader's.
 *
 * The status line under the chart is wired to the loader's snapshot +
 * subscription pair — `loading` flashes during a round trip, and once the
 * generator's backstop is reached the loader reports `done` and stops
 * asking.
 */
import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { HistogramPoint, HistoryStatus, OHLC } from "@finchart/core";
import { OHLCAccessor, candleSeries, crosshair, histogramSeries, infiniteHistory, priceFormat, timeTicks } from "@finchart/core";
import { chartHost, focusRecent } from "./stage";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const title = "Infinite history — infiniteHistory";
export const description =
  "Drag toward the left edge — older bars arrive page by page from a simulated 250ms feed. infiniteHistory(plot, sink, fetch, { from }) owns the cursor and the bookkeeping; the consumer owns fetch and where a page lands. The status line reads the loader's status()/statusChanges pair.";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 7, 10, 9, 0);
const CHUNK = 80; // bars shown at first, and bars per fetched page
const MAX_HISTORY = 1200; // the generator's backstop — reaching it shows `done`

/** Deterministic pseudo-random in [0,1) — one index, always the same value. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

/** A pure function of the index, so the past extends deterministically. */
function priceAt(index: number): number {
  const drift = Math.sin(index / 19) * 700 + Math.sin(index / 67) * 1200 + index * 0.5;
  return Math.max(1_000, 42_000 + drift + (noise(index) - 0.5) * 2200);
}

function ohlcAt(index: number): OHLC {
  const open = priceAt(index - 1);
  const close = priceAt(index);
  const spread = noise(index * 7 + 3) * 700 + 90;
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
    tone: candle.close >= candle.open ? "up" : "down",
  };
}

function bars(from: number, to: number): OHLC[] {
  const out: OHLC[] = [];
  for (let i = from; i < to; i++) out.push(ohlcAt(i));
  return out;
}

/** The exchange stand-in: the page of bars before `before`, after a round trip. */
function fetchOlder(before: number): Promise<OHLC[]> {
  const end = Math.round((before - BASE) / MINUTE);
  const from = Math.max(end - CHUNK, -MAX_HISTORY);
  const page = from >= end ? [] : bars(from, end);
  return new Promise((resolve) => setTimeout(() => resolve(page), 250));
}

const STATUS_LINE: Record<HistoryStatus, string> = {
  idle: "idle — pan left for more",
  loading: "loading older bars…",
  done: "done — the beginning of history",
  terminated: "terminated — the fetch broke its contract",
  stopped: "stopped — the loader was disposed",
};

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 360);

  const status = document.createElement("div");
  status.style.cssText =
    "font-size: 13px; color: #64748b; margin-top: 6px; font-variant-numeric: tabular-nums";
  container.append(status);

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 360)
    .setAxis({
      // timeTicks covers the grid labels only — the crosshair badge reads
      // axis.x.format, and without it the raw epoch ms shows through.
      x: {
        ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }),
        format: (x) => timeFormat.format(x),
      },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const initial = bars(-CHUNK, 0);
  const priceHandle = plot.mainPane.addSeries({
    series: candleSeries(),
    data: initial,
    name: "Price",
  });
  const volumeHandle = plot
    .addPane({ flex: 0.3, minHeight: 50 })
    .addSeries({
      // The volume pane recedes under price: a green/red pair at 45%, the same in
      // both modes, on the series — a CSS variable is chart-wide and would wash
      // an indicator's bars too.
      series: histogramSeries({ style: { up: "rgba(22, 163, 74, 0.45)", down: "rgba(220, 38, 38, 0.45)" } }),
      data: initial.map(toVolumePoint),
      name: "Volume",
    });
  plot.use(crosshair({ magnet: true }));

  let held = initial.length;
  const paint = () => {
    status.textContent = `${STATUS_LINE[loader.status()]} · ${held.toLocaleString("en-US")} bars held`;
  };

  const loader = infiniteHistory(
    plot,
    (older) => {
      // One fetch, two deliveries — the volume pane rides the same page.
      priceHandle.prepend(older);
      volumeHandle.prepend(older.map(toVolumePoint));
      held += older.length;
    },
    fetchOlder,
    { from: initial[0].x, coordinates: new OHLCAccessor() },
  );
  const offStatus = loader.statusChanges.subscribe(paint);
  paint();

  focusRecent(plot, priceHandle.read());

  return Object.assign(
    () => {
      offStatus();
      loader.dispose();
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
