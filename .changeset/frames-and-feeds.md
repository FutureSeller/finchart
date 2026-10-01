---
"@finchart/core": patch
---

A decoration that adds another decoration while it draws is no longer drawn a second time in the same frame. The first x fit always announces its window through `xDomainChange`, even when it happens to equal the scale's starting domain. `conflated(handle, { xOf })` detects a new bar through the x the series reads — pass the series' `getX` when its `coordinates` take x from another field, or every tick folds into one bar.
