---
"@finchart/core": patch
"@finchart/indicators": patch
---

A value range set by hand (`setValueDomain`, a y-axis drag) no longer outlives the data it was set on: once every series goes empty, the next data is fitted on y as well as x, while a range set during the empty state is still kept by that data. A chart whose first data is too short to fill the screen at the default bar spacing — a feed whose first message holds a few bars — keeps fitting x as bars arrive until it fills, then follows the newest bar, like a chart mounted empty. Two `syncX` charts fed from empty both keep following: a peer echoing the identical window no longer ends follow mode, and a listener that throws while a fit is announced no longer ends it either. `pointAndFigureSeries` draws whole columns at both ends of a fit. A decoration that removes itself and adds one lower in the stack while drawing no longer makes the entry before it draw twice in that frame.
