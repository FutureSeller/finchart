---
description: "A live feed: the bar in progress replaced every tick, a new bar opened on the minute."
---

# Real-time ticks

<script setup>
import * as mod from "../../examples/src/cases/realtime";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

The whole wiring — trades folding into bars, the conflated feed, the
snapshot that reconciles, and what to do on reconnect — is spelled out in the
[live feed guide](/guide/live-feed). For the other direction of a live chart —
loading the past as the user pans left — see
[Infinite history](/examples/infinite-history). The doors compose on one
handle: `conflated` feeds the newest bar, `upsert` reconciles the recent
ones, `infiniteHistory` prepends the oldest page.

## Source

`apps/examples/src/cases/realtime.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/realtime.ts
