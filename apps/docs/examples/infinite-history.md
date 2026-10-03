---
description: "Infinite history: pan toward the left edge and older bars arrive page by page — infiniteHistory owns the cursor, the threshold, and the in-flight bookkeeping."
---

# Infinite history — infiniteHistory

<script setup>
import * as mod from "../../examples/src/cases/infinite-history";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

The consumer's whole share is two functions: a `fetch` that produces the page
of bars strictly before a given x (empty array = the end of history), and a
`sink` that says where a landed page goes — here one fetch fans out to the
candle and volume handles. Everything the hand-rolled version had to carry —
the cursor, the "how close to the edge" test, in-flight dedup, trimming the
inclusive boundary bar exchanges like to send back, and re-checking after a
landing (a `prepend` never moves the domain, so no event announces it) — is
the loader's.

One sizing rule worth stealing: against a capped API (Toss and Upbit take
`count` up to 200, Binance `limit` up to 1000), request the cap every time.
One bigger page beats several small ones on every axis at once — round trips
while the user is looking at a gap, request quota, and landings (each landing
recomputes, wholesale, every derivation fed by the source that changed and
declaring no head door — `deriveFirst`, `calcFirst` or `headLookback` — and a price-axis
transform never declares one).

The status line reads the loader's `status()` / `statusChanges` pair — the
same snapshot-plus-subscription shape `usePluginState` consumes in React.

In React, `useInfiniteHistory` holds the data and the loader's place, and
`<InfiniteHistory history>` inside the chart pages into it:

```tsx
const history = useInfiniteHistory<OHLC, string>({ coordinates: OHLC_COORDINATES });
useEffect(() => {
  let current = true;
  api.candles(symbol).then((page) => {
    if (!current) return;
    history.reset(page.bars, {
      next: page.next,
      fetchPage: (cursor) => api.candles(symbol, cursor), // or { fetch: (before) => … } by time
    });
  });
  return () => {
    current = false;
  };
}, [symbol]);

<ChartContainer deps={deps}>
  <ChartCandles data={history.data} />
  <InfiniteHistory history={history} />
</ChartContainer>
```

`history.data` is React state — pass it as the series' data and edit a live
bar with `history.setData`; `history.status` is the loader's state as React
state. The fetch comes with the load — `reset` takes the bars and how to page
back from them, from the scope that knows the symbol — so no later render can
pair one load's token with another symbol's API. The place outlives the chart: a chart remounted under a `key` resumes
from the first bar held and the token last taken, an end stays an end, and a
page landing for a load `reset` replaced is dropped. What `reset` is handed
is the caller's to vouch for: a first page that answers for a symbol already
left (the effect above, cleaned up) must not reach it. An edit through
`setData` is for one load's bars and is dropped if React applies it once
another load holds them: by default the load on screen when it's made, so a
tick for a symbol being left never lands on the next one's bars; a feed that
already knows its new load names it — `setData(update, load)` with the
handle `reset` returned (`history.load` reads the one on screen). One `<InfiniteHistory>` pages a history at a time;
a second one mounted alongside is refused, since two loaders on one token
would fetch and prepend the same page twice. The wrapper demo
(`apps/examples/src/App.tsx`) pages by time this way.

**A page counts once it reaches the chart.** The loader asks for the next page
only when the chart holds the one before it (`plot.getDataRange()` reaches the
page's first x) — a `setState` prepend lands a frame later, and the loader looks
again on that frame. A page the chart refuses never lands, so the loader stops
asking instead of piling up pages nobody draws. Outside React, a consumer that
starts a new loader from the same place reads the token from the cursor-mode
loader's `cursor()` — an empty page moves it without reaching the sink.

For a live feed on the same chart, wrap the handle with
[`conflated`](/examples/realtime) — the two doors compose on one handle and
are torn down together when the symbol changes.

## Source

`apps/examples/src/cases/infinite-history.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/infinite-history.ts
