---
"@finchart/core": minor
---

`infiniteHistory` has a cursor mode for APIs that page by a token instead of a time: pass `cursor` and a fetch `(cursor) => { bars, next }`. The loader still trims and judges gaps by x from `from`, asks with each delivered page's `next`, and moves the token only after delivery, so a failing sink retries the same token. `next: null` ends the history after that page's bars are delivered. A page that keeps no older bar is not the end while it has a `next`; nine in a row terminate with a `DataError`. A page that isn't `{ bars, next }` terminates, and `cursor: null` is refused. The x mode's options now type `cursor` out, so options held in a variable can't carry one into an x fetch. New types: `HistoryPage`, `HistoryCursorFetch`, `InfiniteHistoryCursorOptions`, `HistoryOptionsBase`.
