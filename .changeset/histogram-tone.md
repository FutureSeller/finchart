---
"@finchart/core": minor
---

A histogram bar can carry its direction as `tone: "up" | "down"` and the theme picks the colour — two new variables, `--chart-histogram-up` and `--chart-histogram-down`, falling back to the candle's colours. Resolution follows CSS specificity: `point.color`, then a slot override (`style: { up, down }`), then one explicit series colour (`style: { color }`), then the slot's variable — and, for a bar without a tone, `--chart-histogram`. A bar with a tone never reads `--chart-histogram`; `color` stays as the explicit, unthemed door. `HistogramSeriesStyle` (and `DEFAULT_HISTOGRAM_STYLE`) gained the two leaves `up` and `down` — an object you build to that full type needs them; `style` overrides stay partial.
