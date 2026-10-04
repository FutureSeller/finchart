---
description: "What a chart actually costs to download, and how to make it cost less — hand the pieces to createPlotDeps yourself instead of taking the browserDeps preset, and see what drops out, what it saves in bytes, and what stays behind regardless."
---

# Shrinking the bundle

## What a chart costs

Before shrinking anything, here is what the preset costs. Each row is a
scenario `pnpm size` measures on every CI run — minified, gzipped, with every
`@finchart` package that row uses bundled in.

<!-- bundle-budgets:start -->

| What you build | Download, gzipped |
| --- | ---: |
| The quick start — one candlestick chart | 32.0 KB |
| ...plus a volume pane, axes, crosshair, legend and tooltip | 37.4 KB |
| ...plus four indicators (MA, MACD, RSI, Bollinger) | 43.7 KB |
| ...plus every drawing tool | 53.2 KB |
| The same screen through `@finchart/react` | 53.7 KB |

<!-- bundle-budgets:end -->

React itself is excluded from the last row — a React app already ships it.

**These are ceilings, not snapshots.** CI fails the moment a bundle crosses
one, and today every row measures within 5% of its number. Adding up the
per-package budgets in the READMEs gives a larger total: each of those is
measured with its peer packages excluded, so the shared core gets counted
more than once.

## Wiring it yourself

Where every byte is budget — an embedded widget, a static chart — you can pick
the pieces you need by hand instead of taking the preset (`browserDeps()`).

`browserDeps()` is a preset — you stand a chart up in one line, and in exchange
everything the preset references ships in the bundle regardless of the options.
That is why `pointer: false` leaves the size identical down to the byte: **a
bundler cannot see "does this run", only "is this referenced".** An option is a
door that turns behavior off, not a door that takes bytes out.

The door that takes bytes out is this one — hand the pieces to
`createPlotDeps` yourself:

<<< ../snippets/explicit-wiring.ts{ts}

The same candlestick chart stands up lighter than the preset's. What is missing
is exactly what you did not import:

| Not shipped | min | When you need it |
|---|---:|---|
| the whole pointer vocabulary | ~6.4 KB | `interactions: pointerInteractions(container)` |
| dragging pane dividers | ~1.5 KB | `createDividers: createDomDividers` |
| the gradient painter | ~1 KB | `createCanvasRenderer(surface, { painters: { [LINEAR_GRADIENT]: paintLinearGradient } })` |
| the preset wiring itself | ~700 B | — |

Gradients **do not break** without the painter — an area's `fillBottom` or a
`charts/linear-gradient` style is demoted to the flat color of its first stop
(the fallback contract). When you want to see the gradient, that one
`painters` line above is the door.

## What stays anyway — and why it stays

Two things stay even when you go all the way down to explicit wiring. Not
because they are small enough to forgive — each has a contract as its
justification:

- **The decimation default** (~1 KB) — `M4Decimation`, the strategy
  `createPlotDeps` falls back to when neither the registration nor the series
  names one. The moment a derived series (an indicator) attaches, 100k points
  lean on it. Take it out and "I attached an indicator and it got slow"
  becomes the default behavior — the frame budget (16.7ms at 60Hz) stands on
  this default. If you have a strategy of your own, swap it in with
  `createDecimation`; that replaces only this fallback — a density
  (`pointsPerPixel`) resolves on its own, and a registration's or series'
  own fields still win.
- **The axis-drag consumer** (900 B) — part of the plot's input contract. The
  input stack is first-class even headless (you feed synthetic input through
  `routeInput` — [Testing your chart](/guide/testing)), so it lives on the plot
  itself, not in the browser wiring.

If this list grows, that is a bug — a passenger must have either **a door (an
import boundary)** or **a justification (a contract in writing)**, and "it's
small, it's fine" is not a justification (PRINCIPLES 27).

## When to use which

- **The preset** — starting out, prototypes, a trading screen that uses every
  interaction. The quick start stands up as written, and gradients, dividers
  and pinch just work.
- **Explicit wiring** — embedded widgets, static charts, anywhere bytes are
  budget. Import each piece when you need it — the table above is the price
  list.

The two are two assemblies of the same `PlotDeps` contract, so you can switch
at any time — start on the preset and descend to explicit wiring and your
component code does not change (only the `deps` in
`PlotBuilder.create(deps, …)` moves).
