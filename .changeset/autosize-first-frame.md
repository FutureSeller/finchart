---
"@finchart/dom": patch
"@finchart/core": patch
"@finchart/react": patch
---

`autoSize` measures the container when the chart is built, so a container that is already laid out gets its first frame drawn at its own size. Before, the first frame was drawn at the size the chart was built with (`setSize`, or 800×600 in `<ChartContainer>`) and fitted on the next frame, so the wrong-size frame could be shown — seen in Safari. A container that isn't displayed yet is still fitted by the first `ResizeObserver` callback. `observeElementSize` now calls back once synchronously, before it returns, with the element's current content size when the element is laid out.

A size observer that reports a negative, NaN or infinite size is now ignored, like zero, instead of throwing.
