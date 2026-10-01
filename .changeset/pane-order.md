---
"@finchart/core": minor
"@finchart/react": minor
---

`plot.setPaneOrder(panes)` restacks the chart's panes top to bottom — every pane once, the main pane anywhere — keeping their instances, series, scales and state; it rings one `stateChange`. `<ChartPane>`s now stack in JSX order: a pane inserted above others, or keyed panes reordered, move on the chart. The JSX restacks only when a pane's place in it moves, once per commit, so a `plot.setPaneOrder` or a pane added through `plotRef` holds across re-renders that move nothing. When an effect replay rebuilds the chart (React's `<Activity>` hiding and showing the tree), every `<ChartPane>` and series mounts again on the new chart instead of staying bound to the destroyed one. `usePlot` takes the series off the chart when `series` is omitted, and a commit that changes both `series` and `data` lands the new data on the new series in one step.
