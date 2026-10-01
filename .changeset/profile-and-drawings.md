---
"@finchart/indicators": patch
"@finchart/tools": minor
---

`volumeProfile` finds the first visible bar by binary search, so its per-frame cost follows the visible bars rather than the whole history. `parseDrawings` and `load` read only the current drawings format: nothing was published in version 1, so a version-1 payload is refused like any unknown version and its position-derived ids are gone.
