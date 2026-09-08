---
description: "RSI, MFI and Stochastic RSI sharing one 0–100 pane, Williams %R and CCI in their own — the definition decides each axis."
---

# Oscillators — RSI · MFI · Stochastic RSI · CCI · %R

<script setup>
import * as mod from "../../examples/src/cases/oscillators";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Source

`apps/examples/src/cases/oscillators.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/oscillators.ts
