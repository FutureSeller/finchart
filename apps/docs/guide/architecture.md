---
description: "Why @finchart separates chart commands, browser rendering, framework bindings, indicators, and drawing tools."
---

# Architecture

## Headless Core

`@finchart/core` has zero dependencies and no DOM — it computes layout and
emits draw commands. The same commands drive browser rendering and let tests
inspect what the chart would draw.

- **Runs anywhere** — Node, workers, tests, SSR, no `jsdom` needed
- **Test without a browser** — assert on draw commands directly, with no
  screenshot required ([testing guide](/guide/testing))
- **Bring your own renderer** — `@finchart/dom` wires it to a real `<canvas>`,
  but that's just one wiring choice

## Framework Agnostic

The core doesn't know React exists. `@finchart/react` is a thin wrapper on top
of it, wired the same way `@finchart/dom` is.

- Use it from TypeScript directly, no framework required
- A wrapper for another framework would sit on the exact same core

## Extensions use the core's contracts

Indicators expose computed outputs as data sources, so one calculation can
feed another indicator or several series. Drawing tools use the plugin and
input-consumer contracts to capture gestures before chart panning. Both ship
as separate packages; adding them did not require indicator- or drawing-specific
methods in `@finchart/core`. See [custom indicators](/guide/extensions) and
[drawing tools](/guide/interaction).

## Choose the browser assembly

`browserDeps()` supplies a ready-to-use renderer, scheduler, and interactions.
For a smaller or specialized chart, `createPlotDeps` accepts the pieces you
choose. The [bundle guide](/guide/explicit-wiring) measures concrete @finchart
setups and explains which imports change their size. Those figures are bundle
budgets, not performance or size comparisons with other libraries.
