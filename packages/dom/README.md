# @finchart/dom

The browser shell for `@finchart/core` — what react-dom is to react.

## Install

```sh
pnpm add @finchart/dom @finchart/core
```
`@finchart/core` is a peer — install both.

Core knows nothing about the DOM, at runtime or in its types. Everything you
need to stand a chart up in a browser is here:

- **Assembly** — `browserDeps(options)` returns a recipe
  (`(container) => PlotDeps`), and `PlotBuilder.create(...).build(el)` feeds it
  the element to finish the wiring. Every binding to the DOM happens at that
  assembly step.
- **Implementations** — DOM layers (`createDomLayers`), DOM axis labels, pane
  separators, pointer input (pan, zoom, pinch, keyboard), the CSS variable
  reader, and size observation.
- **DOM overlay extensions** — `legend()` and `tooltip()`. They live here
  because they render into an overlay rather than onto the canvas.

```ts
import { candleSeries } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";

const plot = PlotBuilder.create(browserDeps({ autoSize: true }), candleSeries())
  .addDataPoints(data)
  .build(document.getElementById("chart")!);
```

Headless consumers (servers, workers, tests) don't install this package —
`createPlotModel` from `@finchart/core` is all they need.

## Touch and trackpad

The chart takes horizontal gestures and leaves vertical ones to the page:
the container is `touch-action: pan-y`, so a vertical swipe over a chart that
sits in a scrolling page scrolls the page. What that gives up on touch is
dragging the value axis vertically; a mouse is unaffected.

The wheel zooms on every event by default, which means a trackpad's
two-finger scroll zooms the chart instead of scrolling the page. On a page
with content around the chart, gate it on a modifier:

```ts
browserDeps({ pointer: { wheel: "modifier" } });
```

Then a plain wheel or two-finger scroll reaches the page, and Ctrl + wheel
zooms — which is how Chromium, Firefox and WebKit encode a trackpad pinch,
so pinching still zooms. ⌘ + wheel is accepted as a shortcut as well.

When the pointer leaves the chart (or the browser takes over a touch
gesture), the crosshair is cleared: the `crosshair` event fires once with
`null`, and the tooltip and legend follow it.

A series that describes itself gets its own rows — a candle reads `SOXL: O 105.75 H 106.10 L 104.90 C 105.30 V 800` in the tooltip (`SOXL O …` in the legend) instead of one close. `formatValue` still formats every plain value; give `formatRow` (`(value, { label, sample }) => string`) to read a row by its label, so `V` can be a volume and not a price.

## Support matrix

- **Node 18+** — where the headless path (SSR, workers, tests) runs.
- **Browsers — Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03).
  The floor is set by `structuredClone`, `Object.hasOwn`, and
  `Array.prototype.at`, and **no polyfills ship** — bring your own if you need
  to support something older.
- The repository's own toolchain (Node 24 · pnpm 11) is higher than this. That
  is **the contributor's floor**, not the consumer's.

## Docs

- **Style tokens** — the full CSS variable table — [`theme.md`](https://github.com/finchart/finchart/blob/main/apps/docs/guide/theme.md)
- **The Plot contract** — [plot-contract.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/plot-contract.md)
- **Glossary** — [glossary.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/glossary.md)
