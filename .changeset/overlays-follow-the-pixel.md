---
"@finchart/dom": minor
---

`tooltip()` and `legend()` read the bar under the cursor's pixel at every render, as the crosshair line does, so a keyboard pan, a live feed shifting the view or a linked chart moving it no longer leaves them showing a bar that is not under the pointer. **Type change**: both now ask their host for `XCoordinates` (`xAt`) — `Plot` provides it, but a hand-built host passed to either plugin must add `xAt(pixel)` or it no longer type-checks.
