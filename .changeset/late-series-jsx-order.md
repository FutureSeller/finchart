---
"@finchart/react": patch
---

A `<ChartSeries>` or `<ChartPane>` switched on by its own component's state now takes its JSX place instead of landing at the back until its pane or the container rendered again; the pane or container renders once more to place it, and the pane's list never shows the series at the back in between. A `plot.setPaneOrder` you made now holds until a `<ChartPane>` mounts or moves past another in the JSX: a series appearing between two panes, or a pane going, no longer restacks the panes. A main pane whose `<ChartPane>` went goes back to the top at the next restack, and takes its JSX place again when one claims it back. The exported `SeriesCollector` type gains a required `rank` member, and `keep` now requires its rank.
