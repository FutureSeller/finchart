---
"@finchart/core": patch
---

A divider drag freezes the heights on screen into `flex` scaled so the flex total stays near what it was (by a power of two, exact in floating point) instead of as raw pixels — so a pane added afterwards at the default `flex: 1` gets a share in the same units as the rest rather than being squeezed to its `minHeight`. And the loops that call into someone else's code mid-walk — fitting each pane's value axis (a series' `valueExtent`, a source's `read`), measuring the data's x range and per-series x values, probing for a tooltip, and asking focus claimants (`areaOf`) — walk the list as it stood and skip only what left, so a pane, series or claim removed from inside one of those calls no longer makes the next one go unasked.
