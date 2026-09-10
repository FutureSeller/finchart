---
"@finchart/core": patch
---

`fixedBars` now reaches the limits of what a `Date` can hold, wherever the start of the bar holding an instant is itself one. It used to stop three days inside each end, a margin that belongs to `sessionStart` — which asks a clock about the midnight two days out and cannot be asked at the very edge — and was lent to every producer by the shared check. Each producer now states its own reach: a session still stops three days inside, and a fixed grid, which asks no clock anything, refuses only where the bar holding the earliest instant began before it.
