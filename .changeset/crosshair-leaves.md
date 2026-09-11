---
"@finchart/core": minor
"@finchart/dom": minor
"@finchart/react": minor
---

The crosshair can be nowhere. The `crosshair` event fires once with `null` when the pointer leaves the chart, and `Plot.crosshair(null)` / `InteractionTarget.crosshair(null)` are the doors for it; the crosshair line and the tooltip clear on it, the legend goes back to the latest value, `<SyncX>` clears its siblings, and `<ChartContainer onCrosshair>` receives the `null`. A tooltip left holding the last value on a live chart read as the current price. The default pointer interactions clear on `pointerleave` and `pointercancel` — not during a drag, which goes on through the document.
