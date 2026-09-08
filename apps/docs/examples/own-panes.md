---
description: "MACD, ADX, OBV and CR, each making the pane it mounts into and tearing it down on dispose."
---

# Own-pane indicators — MACD · ADX · OBV · CR

<script setup>
import * as mod from "../../examples/src/cases/own-panes";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/own-panes.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/own-panes.ts
