---
"@finchart/indicators": minor
---

`heikinAshiLast` — the tail of `heikinAshi`, for `deriveLast`: registered with it, a tick folds one Heikin-Ashi bar from the last one held instead of re-deriving the tape. `ichimoku({ ahead })` runs the leading spans and the cloud `displacement` bars past the last candle, at the x the feed gives the bars after it (`(lastX, steps) => x`; absent, the cloud still stops at the last candle), and `attachIchimoku` passes it through; `ichimoku` also lands a history page through its own head door now, correcting `max(conversion, base, span) − 1 + displacement` bars and keeping the rest, the projection included. The README says which indicators have no head door and why a page can change their whole series — a seed that is history is not a defect.
