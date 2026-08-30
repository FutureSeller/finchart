---
description: "Floor pivots with the period boundary supplied by the consumer, because only the app knows what a session is."
---

# Pivot Points — the period is the consumer's knowledge

<script setup>
import * as mod from "../../examples/src/cases/pivots";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/pivots.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/pivots.ts
