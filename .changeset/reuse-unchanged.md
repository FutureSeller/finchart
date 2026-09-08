---
"@finchart/core": minor
---

`reuseUnchanged(previous, next)` — hands back the previous output object wherever a wholesale recompute produced the same plain record, so a `calcLast` written as "recompute, then reuse" keeps its consumers on the tail path. Pure: neither argument is touched; only plain data records are judged.
