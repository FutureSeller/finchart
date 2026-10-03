---
"@finchart/core": patch
"@finchart/dom": patch
---

An x-axis label or crosshair badge centred on a tick at the data area's edge stays on the chart instead of hanging half off and being cut — it is kept between the data area's edge and the y-axis gutter on its side, on canvas through `within` and in the DOM through a CSS `clamp()` on its centring, so nothing is measured.
