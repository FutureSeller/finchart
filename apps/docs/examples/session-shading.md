---
description: "A gradient band over the after-hours stretch, drawn through a custom command that travels with a flat fallback — the renderer that knows the command is injected; hours are read in UTC from the ticks."
---

# Session shading — a custom draw command with a fallback

<script setup>
import * as mod from "../../examples/src/cases/session-shading";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/session-shading.ts` — the case, type-checked in CI.

<<< ../../examples/src/cases/session-shading.ts

The decoration and the renderer it needs — `apps/examples/src/session-shading.ts`:

<<< ../../examples/src/session-shading.ts
