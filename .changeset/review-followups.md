---
"@finchart/core": patch
"@finchart/dom": patch
"@finchart/react": patch
---

Keep requested historical x windows through live updates that do not move the view, and draw pane dividers only for the current frame's pane layout. OHLC aggregation now respects the visible point budget at clipped grid edges without changing the internal tier grid. Scales declare a required `kind`, so React panes can accept inline scale factories without replacing a same-kind axis on every render. Tooltips remeasure after a font change even when their text is unchanged.
