---
"@finchart/core": patch
"@finchart/tools": patch
---

A chart with a collapsed pane no longer goes blank when fractional padding or pane gaps leave that pane's edges a hair under 1px apart. A text measurer that reports a NaN or negative height now skips the frame instead of throwing or pushing the panes past the plot. The `deriveLast` length error no longer ends with an internal design-note name. In tools, the snap ring goes away when a draft is undone back to no anchor, discarded by a cancelled pointer, or dropped by switching tools.
