---
"@finchart/core": patch
---

A computed node's declared head door (`headLookback`) re-runs `calc` on a prefix; a `calc` that keeps a resume checkpoint for `calcLast` then held the prefix's end, and the first tick after a history page resumed from it — corrupting the tail for good (MACD off by 55–84% after one page). The tick after a declared landing is now a full computation; `calcLast` resumes only from a checkpoint taken over the whole input.
