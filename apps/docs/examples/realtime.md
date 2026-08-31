---
description: "A live feed: the bar in progress replaced every tick, a new bar opened on the minute."
---

# Real-time ticks

<script setup>
import * as mod from "../../examples/src/cases/realtime";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

For the other direction of a live chart — loading the past as the user pans
left — see [Infinite history](/examples/infinite-history). The two doors
compose on one handle: `conflated` feeds the newest bar, `infiniteHistory`
prepends the oldest page.

## Source

`apps/examples/src/cases/realtime.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/realtime.ts
