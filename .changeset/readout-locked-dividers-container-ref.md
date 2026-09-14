---
"@finchart/core": minor
"@finchart/dom": patch
"@finchart/indicators": patch
"@finchart/react": minor
---

A series registration takes `readout: false` for a series drawn for the eye rather than read out — a band fill, a marker row. The tooltip and legend leave it out; `probe` still returns it, marked `readout: false` on the sample (the field is present only then), so snapping and the crosshair magnet are unchanged. Like `name`, it is fixed at registration. **Behavior change**: the Bollinger, Keltner, Donchian and Ichimoku fills and the two Squeeze Momentum marker rows are registered with `readout: false`, so the tooltip no longer shows their unlabeled value rows. React `<ChartSeries>`, `<ChartLine>` and `<ChartCandles>` take `readout`. A pane divider whose limits meet — both panes at their floor — is marked `aria-disabled="true"` with the default cursor and starts no drag; it stays focusable and still keeps its arrow keys. `<ChartContainer containerRef>` holds the element the chart is built on, so a toolbar can hand focus back after a click (`containerRef.current?.focus()`), and the plot contract guide now shows that instead of claiming a React ref already did.
