---
"@finchart/core": minor
---

`SeriesHandle.upsert(points)` — a REST snapshot is one call. Every x it names becomes the snapshot's: what the series held at that x is replaced, and an x it did not hold is put where it belongs. An x it does not name keeps what it had, so a sparse correction is not a deletion and a snapshot that ends before the live tail does not cut the tail. A reconnect gap and the previous bar's corrected volume, which used to take `append` plus `updateLast` and had no door at all for the correction, are one `upsert`. History brought in by `prepend` keeps its objects; an x before the first point held is refused with a `DataError` naming `prepend`; removing a bar stays `setData`'s job. The domain is left alone the way `append` leaves it. Which bars a snapshot may speak for is the app's to decide — hand over closed bars, and `flush()` a `conflated` feed first.

`DataManager` gains an optional `merge?(points)`; a custom manager without it is handed the merged array through `setData`. A derivation's `upsert` recomputes the derivation in full; the tick path (`updateLast`) is unchanged.
