---
description: "Two charts linked with syncX, sharing a time window while keeping their own settings."
---

# Two charts in sync — syncX

<script setup>
import * as mod from "../../examples/src/cases/sync-x";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/sync-x.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/sync-x.ts
