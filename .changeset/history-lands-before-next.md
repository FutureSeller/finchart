---
"@finchart/core": minor
"@finchart/indicators": patch
---

`infiniteHistory` asks for the next page only once the chart holds the one before it — `plot.getDataRange()` (new: the x range of the data held, the value `xDomainChange` carries as `dataRange`) has to reach the page's first x. A sink that lands pages a frame later (a React state prepend) is re-judged on that frame; a page the chart refuses never lands, so the loader stops instead of fetching without end. `InfiniteHistoryHost` picks `getDataRange` too. A window set before the data held — a jump to a date not loaded yet — is re-placed at the x asked for as older bars arrive, instead of staying where the first extrapolated guess put it; it lets go on a pan, a zoom, a follow of a new bar, or once it sits inside the data. And the fold kernels (`sumFold`, `highestFold`, `lowestFold`, `stddevFold`, `linregFold`, `lagFold`) grow their window with the values that arrive instead of allocating the period up front, so a period far longer than the data — a typo in a period field — costs what the data costs instead of crashing on `Invalid array length`.
