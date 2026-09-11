---
"@finchart/dom": minor
---

The chart container is `touch-action: pan-y` instead of `none`: a vertical swipe over a chart that sits in a scrolling page scrolls the page, and the chart keeps horizontal gestures. What that gives up on touch is dragging the value axis vertically; a mouse is unaffected. `pointer.wheel: "modifier"` gates wheel zoom on Ctrl/⌘ — which is also what a trackpad pinch sends — so a plain wheel or two-finger scroll reaches the page; the default stays `"always"`.
