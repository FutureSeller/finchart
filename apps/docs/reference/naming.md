---
description: "The rules the public API names follow — what is a get, a set, an apply, a use, and why each verb was chosen."
---

# The Grammar of Names

Before you skim the API alphabetically, one rule is enough — **does the name
carry `attach`?**

## Names without `attach` — they only compute

Functions like `rsi()`, `macd()`, `bollingerBands()` know nothing about the
DOM or the canvas. They take data, compute values, return them. The return
values (`Rsi`, `Macd`, …) draw nothing on screen — they are
[computed nodes](/guide/plot-contract#computed-nodes), made to be read as numbers
or fed into another computation. Headless testing is possible because of this
half.

```ts
import { rsi } from "@finchart/indicators";

const node = rsi(source, { period: 14 }); // values come out with no screen
```

## Names with `attach` — they mount onto a pane

Functions carrying `attach` — `attachRsi()`, `attachMacd()`,
`attachBollingerBands()` — take a `Plot`, mount a series onto a pane, wire up
the axis and baselines, and hand back `dispose()`. Internally they call the
bare function of the same name — `attachRsi` calls `rsi()` and lays pane
wiring on top of it. That's why computation and rendering never sit mixed
together in one function.

```ts
import { attachRsi } from "@finchart/indicators";

const rsiPlugin = plot.use(attachRsi({ source, period: 14 })); // this one shows up
```

Where a bare name and an attach name come as a pair, bare only computes and
attach is the one that puts it on screen — that naming rule is why
`plot.use(macd(...))` is **rejected with a `ContractError`** (`use(plugin)`
wants a function, and a computed node is an object). The console already
tells you the answer: follow the error message and you land on the missing
`attach*`.

An aside: because of this rule, an alphabetical read of the API Reference
bunches all 17 `attach*` functions up near A — a structural fact the naming
rule produced, not a broken list.

## The rest of the names are inferred the same way

`attach`/bare is the distinction you meet most often, but the whole public
API follows the same principle (from the name alone you should be able to
infer "what does it return, and where does it plug in").

- **Ingredients are nouns** — plugin factories you plug into `use`, like
  `crosshair()`·`tooltip()`·`legend()`·`drawingTools()`; ingredients you plug
  into registration, like `lineSeries()`·`priceLine()`. Make one, plug it in,
  done. Computed nodes are nouns too — `macd()`·`rsi()` return a value (a
  node) and install nothing.
- **`create*` is the default-implementation factory for a contract** — like
  `createCanvasRenderer`, it hides the implementation class and hands back
  the contract type.
- **State decides value or function** — even among things that go into the
  same slot, **stateless means a value** (`immediateScheduler`·`noStyle`) and
  **a parameter or per-instance state means a function**
  (`frameScheduler(view?)`·`manualScheduler()`, which builds a fresh `flush`
  per instance). The split in call shape isn't asymmetry — it makes that
  difference visible; wrapping a stateless thing in a function would turn
  every call into a ceremony that rebuilds the same closure. Misuse is caught
  by the compiler.

**One name that breaks the rule (kept as is)**: `cssReader(container)` in
`@finchart/dom` returns a `StyleReader` (a contract), so it belongs in the
`create*` slot, but it has no prefix. **We decided not to rename it** —
`createCssReader` collides with an **old slot name**
(`PlotDeps.createCssReader`, now `createStyleReader`), so satisfying one rule
would leave the same name pointing at two different things in two eras. That
cost outweighs rule purity. New names do follow the rule above.

## Two packages: core and dom

`@finchart/core` and `@finchart/dom` are separate packages, not subpaths of
one package — worth pinning down, because it's an easy import path to get
wrong.

- **`@finchart/core`** — all of the computation, the model, and the rendering
  contracts. Decorations and plugins that don't build DOM elements
  themselves, like `crosshair()`, live here too. Nothing here needs to know
  about the DOM, and that boundary is what makes headless testing and server
  rendering possible.
- **`@finchart/dom`** — everything that builds and attaches DOM elements
  itself, like `tooltip()`·`legend()`, plus all of the browser wiring:
  `browserDeps()`·`PlotBuilder`·`createDomLayers`. You need a browser to use
  it.

The packages split this way because of a headless-first design — only the
implementations that genuinely require the DOM (DOM layers, canvas renderer,
text measurer, and so on) live in `@finchart/dom`; the rest stays open to
testing or server rendering through the same entry point (`@finchart/core`)
with no browser. The two packages **ship together on one version** — details
are in the [60-second tutorial](/guide/getting-started).

## Serialized string unions

A string that gets **saved** — `Drawing["type"]`, say — is a name you can
never take back: it sits in a consumer's localStorage and their server long
after a rename ships. Three rules, set before the drawing vocabulary grew:

- **A member names one tool, without repeating its type** — `horizontal`,
  not `horizontalLine`; the union already says it's a drawing.
- **Don't reuse a word a public core type owns** — `Range` belongs to the
  `Range { min, max }` type (the glossary pins that as the *only* non-pixel
  sense of the word), so a measuring tool is a `measure`, not a range.
- **After release, a member changes only through a format migration.**
  Before release is the one free window — that's when `verticalLine` became
  `vertical`.
