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

In React, the sink is a `setState` prepend — see the wrapper demo's
`ChartHistory` component (`apps/examples/src/App.tsx`) for the recipe.

**A page counts once it reaches the chart.** The loader asks for the next page
only when the chart holds the one before it (`plot.getDataRange()` reaches the
page's first x) — a `setState` prepend lands a frame later, and the loader looks
again on that frame. A page the chart refuses never lands, so the loader stops
asking instead of piling up pages nobody draws. If the chart can remount while
the data lives above it (state that outlives the container), keep the loader's
place with the data too — its first x and paging token — and install from there,
or the new loader fetches the first page again on top of bars that hold it.
For a live feed on the same chart, wrap the handle with
[`conflated`](/examples/realtime) — the two doors compose on one handle and
are torn down together when the symbol changes.

## Source

`apps/examples/src/cases/infinite-history.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/infinite-history.ts
