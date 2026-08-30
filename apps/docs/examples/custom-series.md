---
description: "A series the library does not ship, drawn through the custom command with a fallback for surfaces that do not know it."
---

# Custom series — volume dots

<script setup>
import * as mod from "../../examples/src/cases/custom-series";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/custom-series.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/custom-series.ts
