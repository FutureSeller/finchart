---
"@finchart/core": minor
"@finchart/tools": patch
---

A price line's badge text picks black or white — whichever has the larger contrast — when the badge colour is an opaque `#rgb`, `#rrggbb` or `rgb()` with integer channels (comma or space syntax, alpha exactly 1). Any other colour — translucent, a percentage, a named colour, `var()`, `color-mix()`, `hsl()` — keeps the white text it had; the default `#94a3b8` line now gets black text. `TextParams` takes `within: { left, right }`: the renderer that draws measures the text and slides it, box and padding included, back inside that horizontal range, or onto `left` when it is wider; the recording renderer passes it through, and a custom replayer that ignores it draws the text where its anchor put it. Fibonacci retracement and extension level labels use it, so they no longer run off the pane's left edge.
