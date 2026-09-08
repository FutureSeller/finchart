---
"@finchart/indicators": minor
---

The default up/down pair of the `attach*` palette is now the core's (`#16a34a` / `#dc2626`, the candle's fallbacks) instead of `#10b981` / `#ef4444`. It shows wherever an attach painted a direction and the caller gave no `colors`: Elder-Ray's bull/bear lines, ADX's +DI/−DI, Ichimoku's spans, SuperTrend's up/down line, Pivot's R/S levels, and Squeeze Momentum's marker rows — which, with no histogram theme set, now share one green and one red with the momentum bars beside them (a themed `--chart-histogram-up/down` moves the bars, not the rows).
