---
"@finchart/indicators": minor
---

MACD's `histogram`, the Awesome Oscillator's `ao` and Squeeze Momentum's `momentum` are now `HistogramPoint[]` whose bars carry their direction against the bar before as `tone` (`"up"` on a rise or a tie, `"down"` on a fall, none on the first value or after a gap); the theme colours them through `--chart-histogram-up` / `--chart-histogram-down`. If your theme set only `--chart-histogram`, set those two as well — a toned bar does not read the plain variable. The `attach*` colour options are unchanged: one colour given there still colours every bar. The three declare one more bar of landing lookback. The fold builder takes `toneKeys` for the branches that carry a tone.
