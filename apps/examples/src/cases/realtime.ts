/**
 * A live feed, wired the way a real one is: **trades fold into bars,
 * bars go through a conflated feed, and a periodic snapshot reconciles.**
 *
 * Three doors do the work — `barAggregator` folds each trade into the bar
 * in progress, `conflated` delivers the latest state of that bar once per
 * frame through `updateLast`, and `upsert` merges the exchange's snapshot
 * of closed bars by x: the ones it names are corrected (here, the wick the
 * tape never visited and the volume its slices rounded away), the ones it
 * does not name are left alone.
 * "Disconnect" stops the trades while the script keeps running; "Reconnect"
 * is one `upsert` of the closed bars missed, and the trades resume.
 */
import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC, Trade } from "@finchart/core";
import {
  barAggregator,
  candleSeries,
  conflated,
  fixedBars,
  priceFormat,
  timeTicks,
} from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Real-time ticks";
export const description =
  "Trades arrive every 400ms and fold into the bar in progress (barAggregator + fixedBars); a conflated feed delivers that bar once per frame through updateLast, and the first trade of a new minute opens a new bar. Every twelve trades the exchange's snapshot of every bar closed since the last one lands through upsert — each closed bar grows the wick the tape skipped and its exact volume, nothing else moves. Disconnect stops the trades while time runs on; Reconnect is one upsert of the bars missed. The viewport follows (shiftVisibleRangeOnNewBar), and the data is deterministic.";

const MINUTE = 60_000;
/** Trades per scripted bar; each carries a slice of the bar's path and volume. */
const TRADES_PER_BAR = 3;
/** A snapshot of the bars closed since the last one lands after this many trades. */
const SNAPSHOT_EVERY = 12;

/**
 * The exchange's tape: the scripted bar `index`, split into trades. The
 * price walks open → one extreme → close, so the other wick is never
 * traded; the volume is sliced, and the slices round. Both are what a
 * snapshot later corrects — the missing wick is the one you can see.
 */
function tradesOf(bar: OHLC, index: number): Trade[] {
  const volume = bar.volume ?? 0;
  const step = MINUTE / TRADES_PER_BAR;
  const path = [bar.open, bar.close >= bar.open ? bar.high : bar.low, bar.close];
  return path.map((price, k) => ({
    x: bar.x + k * step,
    price,
    volume: Math.round(volume / TRADES_PER_BAR) + (index % 2 === 0 && k === 0 ? 1 : 0),
  }));
}

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "margin-bottom: 8px; display: flex; gap: 8px";
  container.append(toolbar);
  const host = chartHost(container, 480);

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);
  plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 4 });

  // What the exchange has: the whole script. What the chart has: the first 250 bars.
  const script = fixtureCandles(600);
  let revealed = 250;
  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data: script.slice(0, revealed),
    name: "Price",
  });

  /**
   * **Aggregate first, conflate after.** The aggregator folds one trade at
   * a time into the bar in progress; the feed holds the latest state of
   * that bar and hands it to `updateLast` once per frame — fifty trades of
   * one bar between two frames cost one delivery, not fifty. A trade that
   * opens the next bar is the exception: the bar it closes goes out at
   * once, because its final state is data, not something to fold away.
   */
  const bars = barAggregator({ barStart: fixedBars({ interval: MINUTE }) });
  const feed = conflated(price);
  let current: OHLC | null = script[revealed - 1] ?? null;

  /** The exchange's REST answer: its closed bars, exact — the tape's rounding undone. */
  const closedBars = (fromIndex: number, toIndex: number): OHLC[] => script.slice(fromIndex, toIndex);

  let timer: number | undefined;
  let connected = true;
  let tradeCount = 0;
  let tradeIndex = 0;
  /** The first scripted bar the exchange has not yet confirmed to the chart. */
  let reconciledUpTo = revealed;

  const onTrade = (trade: Trade): void => {
    if (!price.attached) return;
    current = bars.fold(current, trade);
    feed.push(current);
  };

  /**
   * **A snapshot names bars; whatever it names is its own.** Every bar
   * closed since the last snapshot is handed over — none is skipped, or it
   * would keep the tape's approximation for good — and the bar in progress
   * is not, because it belongs to the trades. The feed is flushed first so
   * a tick still pending cannot land on top of what the snapshot corrects.
   */
  const reconcile = (): void => {
    const to = revealed; // `script[revealed]` is still forming
    if (!price.attached || to <= reconciledUpTo) return;
    feed.flush();
    price.upsert(closedBars(reconciledUpTo, to));
    reconciledUpTo = to;
  };

  const advance = (): void => {
    const bar = script[revealed];
    if (!bar) {
      reconcile(); // the exchange confirms the last bars before the tape ends
      return pause();
    }

    if (connected) {
      onTrade(tradesOf(bar, revealed)[tradeIndex]);
      tradeCount += 1;
      if (tradeCount % SNAPSHOT_EVERY === 0) reconcile();
    }
    tradeIndex += 1;
    if (tradeIndex === TRADES_PER_BAR) {
      tradeIndex = 0;
      revealed += 1;
    }
  };

  const playButton = document.createElement("button");
  const linkButton = document.createElement("button");
  const pause = () => {
    clearInterval(timer);
    timer = undefined;
    playButton.textContent = "Play";
  };
  const play = () => {
    playButton.textContent = "Pause";
    timer = window.setInterval(advance, 400);
  };
  let disconnectedAt = revealed;
  const disconnect = () => {
    connected = false;
    disconnectedAt = revealed;
    linkButton.textContent = "Reconnect";
  };
  /**
   * Everything that closed while the line was down lands in one call. The
   * bar in progress is the one thing a snapshot cannot give back: if the
   * same bar is still forming, what it had accumulated is kept; if a bar
   * rolled over meanwhile, the new one opens from the next trade and stays
   * short of the trades it missed until the snapshot that closes it.
   */
  const reconnect = () => {
    reconcile();
    if (revealed !== disconnectedAt) current = null;
    connected = true;
    linkButton.textContent = "Disconnect";
  };
  playButton.addEventListener("click", () => (timer === undefined ? play() : pause()));
  linkButton.addEventListener("click", () => (connected ? disconnect() : reconnect()));
  linkButton.textContent = "Disconnect";
  toolbar.append(playButton, linkButton);
  play();

  focusRecent(plot, price.read());

  return Object.assign(
    () => {
      pause();
      feed.dispose();
      plot.destroy();
      toolbar.remove();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
