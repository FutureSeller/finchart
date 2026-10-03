---
description: "Wire a WebSocket + REST feed: trades fold into bars, a conflated feed delivers once per frame, a snapshot reconciles by x, and history pages in from the left — with what to do on reconnect."
---

# Wiring a live feed

Read this if your chart is fed by an exchange: trades over a socket, a
periodic REST snapshot of the recent bars, and older bars fetched as the
user scrolls into the past. Each of those is one door, and the whole of
this page is which door, in which order.

<script setup>
import * as realtime from "../../examples/src/cases/realtime";
</script>

The [real-time example](../examples/realtime) is the trades-and-snapshot
half of this page running (history has its own example, linked below):
{{ realtime.description }}

## The doors

| You have | Door | It does |
| --- | --- | --- |
| a page of bars to start from | `handle.setData(bars)` | replaces everything and fits the view |
| one trade | `barAggregator(...).fold(current, trade)` | folds it into the bar in progress — no array involved |
| the bar in progress, many times a second | `conflated(handle).push(bar)` | holds the latest state and delivers it once per frame through `updateLast` |
| a snapshot of closed bars | `handle.upsert(bars)` | merges by x: the bars it names are corrected or added, the rest are left alone |
| older bars the user scrolled toward | `infiniteHistory(plot, sink, fetch, { from })` | fetches, trims and `prepend`s them, and keeps the cursor |

`updateLast` and `upsert` never ask for a refit; automatic following
(`shiftVisibleRangeOnNewBar`) still applies to a new bar when it is on.
`setData` refits unless told `{ refit: false }`, and even then the first data
a chart ever gets is fitted. `price` throughout is the candle series' own
handle, so its `xRange` is the range of the bars it holds — a derived
series' handle reports its *drawn* range instead.

## The wiring

Everything below is one setup. `socket` and `rest` are yours — a WebSocket
client that emits trades and reconnects, and a REST client that answers
with bars — and `price` is the candle series' handle.

```ts
import { barAggregator, conflated, fixedBars, type OHLC, type Trade } from "@finchart/core";

const INTERVAL = 60_000; // one-minute bars
const start = fixedBars({ interval: INTERVAL }); // where a bar starts; a session is `sessionStart({ timeZone })`
const bars = barAggregator({ barStart: start });
const feed = conflated(price);
let current: OHLC | null = null; // the bar in progress, as the trades have built it

/** A bar the snapshot may speak for: closed, and not before the first bar held. */
const speaksFor = (bar: OHLC): boolean => {
  const held = price.xRange; // null while the series is empty
  return (held === null || bar.x >= held.min) && bar.x + INTERVAL <= Date.now();
};

/** The exchange's view of recent bars, merged by x — steady state and reconnect alike. */
const reconcile = (snapshot: OHLC[]): void => {
  if (!price.attached) return;
  // Flush first: a tick still pending must not land on top of the snapshot,
  // and on an empty series it is the pending tick that decides which bar is
  // the first one held — the filter has to see it.
  feed.flush();
  const closed = snapshot.filter(speaksFor);
  price.upsert(closed);
  // The forming bar is kept only if the snapshot neither named it nor moved
  // the tail past it. Named, it is closed and the snapshot's; passed over, it
  // is closed by omission and keeps what the trades built.
  const tail = price.xRange?.max ?? Number.NEGATIVE_INFINITY;
  const forming = current;
  if (forming !== null && (closed.some((bar) => bar.x === forming.x) || tail > forming.x)) current = null;
};

socket.on("trade", (trade: Trade) => {
  if (!price.attached) return; // the registration may be gone
  const tail = price.xRange?.max ?? Number.NEGATIVE_INFINITY;
  const at = start(trade.x);
  // A replayed trade from a bar the snapshot already closed: drop it. One
  // for the bar still forming (`current.x === tail`) is folded as usual.
  if (at < tail || (at === tail && current === null)) return;
  current = bars.fold(current, trade);
  feed.push(current);
});

setInterval(async () => reconcile(await rest.recentBars(symbol)), 15_000);
socket.on("reconnect", async () => reconcile(await rest.recentBars(symbol)));
```

## Trades → bars → the chart

Aggregate first, conflate after. `barAggregator` needs a rule for where a bar
starts — `fixedBars({ interval })` for a market that never closes,
`sessionStart({ timeZone })` for one whose session is a calendar day — and
folds one trade at a time into the bar in progress; the feed hands the
latest state of that bar to `updateLast`.

The feed matters when the socket is loud: fifty trades of one bar between
two frames cost one `updateLast`, not fifty full-array copies. It holds
**one** pending bar and delivers it on the next frame, so a tick can be up
to two frames behind the wire; `feed.flush()` delivers it now. The one
exception is a rollover — a trade that opens the next bar delivers the bar
it closes at once, because that bar's final state is data. Handing raw
trades to the feed instead of bars would merge them last-wins and lose that
frame's high and low — the aggregator is what keeps them.

One trade makes at most one bar. A stretch the socket missed is not the
aggregator's to fill; that is the snapshot's job.

## The snapshot — steady state

Every so often the exchange gives you its own view of the last N bars, and
`reconcile` hands over the ones it may speak for: **closed** bars — the
chart cannot tell a closed bar from one still forming, and the bar in
progress belongs to the trades — and not before the first bar the chart
holds, because that is history and history has its own door.

`upsert` merges by x. A bar the snapshot names replaces the one the chart
holds at that x — the previous bar's corrected volume, say. A bar the chart
holds and the snapshot does not name stays: a sparse correction is not a
deletion, and a snapshot that ends before the live tail does not cut the
tail. A bar the chart did not hold is put where it belongs. What `upsert`
will not do is reach before the first bar the chart holds, or remove a bar,
which is `setData`'s job.

Which bars are closed is yours to decide. Where the provider marks them,
use that; otherwise `bar.x + interval <= now`, as `speaksFor` does.

## Reconnect

The socket drops, comes back, and the chart's tail is minutes behind the
exchange's. The same `reconcile` fills the gap — closed bars past the old
tail are simply added — and two things around it are what make that safe:

- **The bar in progress is the one thing a snapshot cannot give back.**
  `reconcile` keeps it only when the snapshot neither names it nor moves
  the tail past it — then it is still forming, and the next trade folds
  into what it had. A snapshot that names it has closed it with the
  exchange's values; one that passes over it and adds later bars has closed
  it by omission, with whatever the trades had built. Either way the next
  trade opens a new bar, which stays short of the trades it missed until
  the snapshot that closes it.
- **The socket may replay trades from before the gap fill.** `updateLast`
  throws a `DataError` for an x behind the tail, and a replayed trade for
  the bar the snapshot just closed would open a fresh bar on top of it. The
  trade handler drops both — a trade whose bar starts before the tail, and
  one whose bar *is* the tail when nothing is forming. Where the provider
  numbers its trades, dedupe by that number too; the handler cannot tell a
  replayed trade of the forming bar from a new one.

If the snapshot reaches further back than the first bar the chart holds,
`speaksFor` leaves those out: they are history, and a running history
loader keeps its own cursor at the first bar it delivered — a `prepend` it
did not make would leave that cursor behind. Leave the older past to the
loader; or, if you want it now, dispose the loader, `prepend` the older
bars, and create the loader again from the new first bar.

## History

Older bars come in through `infiniteHistory`, which owns the cursor, the
threshold, the in-flight dedup and the trim:

```ts
import { infiniteHistory, OHLCAccessor } from "@finchart/core";

const loader = infiniteHistory(
  plot,
  price,
  (before) => rest.barsBefore(symbol, before),
  { from: firstPage[0].x, coordinates: new OHLCAccessor() },
);

// On a symbol switch or unmount, before the handle goes:
loader.dispose();
```

`from` is the first x you already hold — the loader never guesses it. Pass
the series' accessor so a page is judged by the same rule the series will
apply (one bar per x). Handing the loader the handle itself (`price`) lets it
see the handle go: a symbol switch that disposes `price` while a page is in
flight stops the loader — `status()` reads `"stopped"` — instead of throwing
from the landing. It looks at the handle only when it asks for or lands a
page, though: an idle loader keeps listening to the chart until then, and a
`done` one never looks again. So dispose the loader on teardown whatever its
sink. A function sink (`(page) => { price.prepend(page);
volume.prepend(...) }`, to feed two panes) has no liveness at all. Its `status()` /
`statusChanges` pair is what a status line or `useSyncExternalStore` reads.

The loader trims every page to the points strictly before the first x it
holds, and that trim matters: an inclusive REST bound hands back the bar you
already have, and `prepend` does not replace a point at the seam. On line
data a repeated first x is kept twice; on bars (one bar per x) it is a
`DataError`. The loader discards it before either can happen.

Some APIs page by a token instead of a time — each response carries the key
for the page before it. Give the loader that token as `cursor` and a fetch
that takes it and answers `{ bars, next }`:

```ts
const firstPage = await rest.barsPage(symbol); // → { bars, next }
price.setData(firstPage.bars);

// null means there is no older page — then there is nothing to load.
const loader =
  firstPage.next === null
    ? null
    : infiniteHistory(
        plot,
        price,
        (cursor) => rest.barsPage(symbol, cursor),
        { from: firstPage.bars[0].x, cursor: firstPage.next, coordinates: new OHLCAccessor() },
      );

// On a symbol switch or unmount:
loader?.dispose();
```

`from` is still the first x held: trimming and gap judgment stay in the
chart's x. The token is opaque — the loader never compares two. A page that
keeps older bars moves it only once they're delivered, so a sink that throws
retries with the same one; a page that keeps none moves it with no delivery. `next: null` ends the history once that page's bars are in. A page
that keeps no older bar is not the end while it has a `next` (a provider can
skip a closed session): the loader moves the token and keeps filling. Nine
such pages in a row terminate the loader with a `DataError` — a fetch that
never goes back in time. `loader.cursor()` reads the token the next fetch
would take — moved by those empty pages too, `null` once the history is
done — which is what a new loader started later from the same place (a
remounted chart) is given as its `cursor`, with the first x held as `from`.

## In React

`@finchart/react` has two lanes, and a live feed fits either. The
**declarative** lane is array-shaped: keep the bars in state, let
`barAggregator.reduce` fold each trade into a new array that keeps every
unchanged bar's object identity — so the chart sees a tail change as a tail
change — and hand that state to `<ChartSeries data={candles}>`; a snapshot is
then a state update too, merged by x the same way. `useDataSource(candles)`
turns the same state into the `Source` an indicator reads (`bars` is the
aggregator from the wiring above).

```tsx
const [candles, setCandles] = useState<OHLC[]>(firstPage);
useEffect(() => socket.on("trade", (trade: Trade) => setCandles((prev) => bars.reduce(prev, trade))), []);
const source = useDataSource(candles);
```

The **imperative** lane hands you the plot — `usePlot()` returns
`{ containerRef, plotRef }`, `useChartPlot()` inside the container returns
the plot itself — and `plot.mainPane.addSeries` the handle;
`updateLast`, `upsert` and `prepend` on it follow the recipes above word for
word. Do not mix the two on one pane: the declarative lane owns that pane's
series list.

## What this page does not decide

Whether a snapshot is newer than the tick you have, whether a bar is closed,
which trades a replay should keep — none of that is visible from inside the
chart, and this page does not pretend otherwise. The doors take what you
hand them; the rules above are the ones that make what you hand them true.
