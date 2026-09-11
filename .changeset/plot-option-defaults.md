---
"@finchart/core": minor
---

`applyOptions({ minBarSpacing: null })` (and `maxBarSpacing`) clears the override so the x mapping's own default is read again — the one pair whose default is not a number the chart owns, so there was no value to write back to get it; `0` keeps meaning "no limit on this side". `PANE_OPTION_DEFAULTS` now carries `autoScale` and `invert` alongside `flex`, `minHeight` and `valuePadding`, so a wrapper that reverts a removed prop reads every default from one set.
