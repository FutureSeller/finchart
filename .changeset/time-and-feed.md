---
"@finchart/core": minor
"@finchart/indicators": minor
---

A `time/` module and the vocabulary a feed needs to turn trades into the bars a chart draws.

**`BarStart`** — where a bar starts is one function: given an instant, the instant the bar holding it opened at. Three laws are the contract — idempotent, monotonic, backward only — and every producer shipped here refuses, with a contract error, any instant it cannot answer for under them. `sessionStart({ timeZone })` is the rule for a market whose session is a calendar day in one place: a session opens at its earliest real instant, so a day whose midnight the clock skipped opens at its first real reading and a date the clock replayed opens once. `fixedBars({ interval })` is the rule for the minute, hour and four-hour bars of a market that never closes, aligned to the epoch, up to a day wide. A week, a month or a session that crosses midnight is a few lines of your own `BarStart`.

**`barAggregator({ barStart })`** — trades fold into the bar in progress, and it is the same bar a merge would make. `fold(bar, trade)` is the imperative path; `reduce(bars, trade)` keeps every unchanged bar's identity so a React state update sees one new object. It is a door: a trade's price, volume and x are checked before folding, because folding erases what it is handed — without the check, a `NaN` price folded into an existing bar would change only its close, while its volume entered the sum.

**`timeTicks` walks the clock's runs.** The axis stopped reading a wall clock as an instant: a reading the clock skipped resolves forward, one it showed twice resolves to its first turn, a stretch the clock jumped over is worth one tick, and no pair draws closer than asked. A zone name that is not one fails in the library's own words, not `Intl`'s.

**`periodAnchor({ barStart })`** in `@finchart/indicators` turns any rule about where a bar starts into the `anchor` that `vwap` and `pivotPoints` take. **`AnchorPredicate` now receives a third argument**, the bar before this one (`null` where there is none, which is what `vwap` passes at index 0; `pivotPoints` never calls with `null`). A predicate may declare fewer parameters, as before; code that reads the type back out and calls it with two arguments, or assigns it to a two-parameter type, has to name the third.
