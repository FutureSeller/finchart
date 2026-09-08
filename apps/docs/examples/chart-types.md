---
description: "swapSeries changes the presentation and nothing else: candles to line to area and back, with the data, viewport and drawings untouched."
---

# Switching chart types — swapSeries changes only the presentation

<script setup>
import * as mod from "../../examples/src/cases/chart-types";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## Key points

- **`swapSeries` changes only the presentation.** Data, viewport, and mounted
  indicators stay as they are — no re-registration, no state copying. That's
  why a type toggle doesn't lose state.
- **The accessor follows the type.** To feed OHLC into a line or an area you
  have to give it an `OHLCAccessor` so it reads the close. Candles and bars
  come with their own accessor by default.
- **Decimation follows too.** Go out to line (four points per pixel column)
  and back to candles (candle aggregation) and the highs and lows aren't erased — the swap replaces the
  list of points to draw with the new series' own.

## Source

`apps/examples/src/cases/chart-types.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/chart-types.ts
