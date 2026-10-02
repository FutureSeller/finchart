---
"@finchart/core": minor
---

A maximized pane is the chart's layout mode: `plot.maximizePane(pane)` lets one pane fill the chart and lays the others at their `minHeight`, `plot.maximizePane(null)` gives the split back, and `plot.maximizedPane` reads it (both on `PaneHost`). No pane's `flex` is written — the user's split stays underneath, a pane added while maximized collapses and comes back at its own flex, and a flex set meanwhile shows when the split does. The maximize ends on its own when its pane is removed, and when a divider is dragged (the heights on screen become the panes' flex). Every change rings `panesChange` once, a lone pane included. `paneMaximize` is now the toggle and the gestures over that state — `maximize`, `restore`, `maximizedPane`, Esc and the opt-in double-click are unchanged — and it no longer rewrites flex or keeps a snapshot of its own; an outside `applyOptions({ flex })` no longer ends a maximize. `dispose()` leaves the layout as it is.
