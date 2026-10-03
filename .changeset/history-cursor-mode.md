---
"@finchart/core": minor
---

`infiniteHistory` has a cursor mode for APIs that page by a token instead of a time: pass `cursor` and a fetch `(cursor) => { bars, next }`. The loader still trims and judges gaps by x from `from`, asks with each page's `next`, and moves the token past a page with older bars only after delivering them, so a failing sink retries the same token; a page that keeps no older bar moves it with no delivery. `next: null` ends the history after that page's bars are delivered. A page that keeps no older bar is not the end while it has a `next`; nine in a row terminate with a `DataError`. A page that isn't `{ bars, next }` terminates, and `cursor: null` is refused. The x mode's options now type `cursor` out, so options held in a variable can't carry one into an x fetch. New types: `HistoryPage`, `HistoryCursorFetch`, `InfiniteHistoryCursorOptions`, `HistoryOptionsBase`, `CursorHistoryLoader`.
