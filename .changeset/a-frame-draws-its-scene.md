---
"@finchart/core": patch
---

A frame draws the scene it began with. Code the chart calls mid-frame — a decoration's `draw` or `axisBadges`, an axis `format` or tick strategy, a text measurer, a custom series' `draw` — may remove or reorder a pane, unmount a decoration or dispose a series; that change now shows on the next frame instead of breaking this one. Before, a pane removed mid-frame handed its ticks (and, from inside the layout, its height and area) to the pane after it, a `format` that removed a pane made the render throw, and a decoration or series removed mid-walk could make its neighbour go undrawn, or its axis badge go missing, for that frame. Something added mid-frame is drawn on the next one.
