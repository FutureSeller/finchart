# Architecture and ownership

The engine separates data, coordinates, drawing, and input contracts. `Plot`
assembles those contracts; browser and React packages connect that assembly to
their environments. Read [PRINCIPLES.md](../PRINCIPLES.md) before widening a
contract or introducing a new dependency.

## Package boundaries

| Location | Responsibility | Runtime peers |
| --- | --- | --- |
| `packages/core` | Data, scales, layout, commands, input routing, and built-in extensions | None |
| `packages/dom` | Browser assembly, layers, pointer input, labels, and DOM overlays | Core |
| `packages/react` | Hooks and declarative components that manage chart lifetime | Core, DOM, React, React DOM |
| `packages/indicators` | Calculations, computed nodes, and indicator representations | Core |
| `packages/tools` | Drawing geometry, interaction, persistence, and plugins | Core |
| `packages/tsconfig` | Shared build and test compiler configuration | Development only |
| `apps/examples` | Runnable demonstrations and the browser benchmark harness | Workspace consumers |
| `apps/demo-vanilla` | An integrated trading screen assembled with vanilla TypeScript | Workspace consumers |
| `apps/demo-react` | A React version of the integrated trading screen | Workspace consumers |
| `apps/demo-toss-invest` | Next.js chart with synthetic data and an optional server-side market-data connection | Workspace consumers |
| `apps/docs` | User guides, checked snippets, and generated API reference | Workspace consumers |
| `e2e` | Real-browser tests and built-package runtime smoke checks | Workspace consumers |

Cross-package imports use package names and declared dependencies, not relative
paths into another workspace. Runtime packages use peer dependencies for their
shared core. [package-boundary-check.mjs](../scripts/package-boundary-check.mjs)
checks relative import boundaries.

## Core module directions

The authoritative dependency allowlist is in
[module-boundaries.test.ts](../packages/core/src/__tests__/module-boundaries.test.ts).
It describes a graph, not a single chain:

| Module | May import other core modules |
| --- | --- |
| `primitives` | None |
| `time` | `primitives` |
| `data` | `primitives`, `time` |
| `scale`, `render`, `interaction` | `primitives` |
| `axis` | `primitives`, `time`, `scale`, `render` |
| `series` | `primitives`, `data`, `scale`, `render` |
| `registration` | `primitives`, `data`, `scale`, `render`, `series` |
| `plot` | `primitives`, `data`, `scale`, `render`, `axis`, `interaction`, `series`, `registration` |
| `extensions` | `primitives`, `data`, `scale`, `render`, `axis`, `plot` |

In particular, `plot` does not import `extensions`. Built-in extensions consume
the assembled chart from above, just as separate extension packages do.
A series knows its representation and coordinates; axes and interactions are
outside its responsibility. Data code does not know the renderer or scales.

The root source files are a deliberately limited surface layer. The boundary
test pins their membership. Public barrels enumerate exports by name;
[public-barrel-check.mjs](../scripts/public-barrel-check.mjs) guards this rule.
The core has separate [headless](../packages/core/src/headless.ts) and
[authoring](../packages/core/src/authoring.ts) entrypoints. Consult package
`exports` and these barrels before exposing an implementation detail.

## Runtime owners

```text
Plot
  shared x scale and mapping
  layers, renderer, scheduler, input routing
  plot plugins and decorations
  mainPane / additional Pane instances
    value scale and layout area
    pane plugins and decorations
    series registrations
      series representation
      data manager, input source, optional derivation
      SeriesHandle returned to the caller
```

Each pane has its own value axis; panes share the plot's x coordinate space.
Data belongs to a registration, not to one chart-wide dataset. The
[registration entry](../packages/core/src/registration/entry.ts) seals the
concrete point type behind operations the pane can use without knowing that
type. A [SeriesHandle](../packages/core/src/plot/series-handle.ts) retains the
typed read and write interface for its caller.

Panes notify the plot about changes. The plot decides whether to update x
membership, refit domains, update layout, and schedule a frame. See
[pane.ts](../packages/core/src/plot/pane.ts) and
[plot.ts](../packages/core/src/plot/plot.ts); avoid turning every pane change
into an unconditional data rebuild.

## Assembly and environment boundaries

[createPlotDeps](../packages/core/src/plot/presets.ts) requires factories for
layers, rendering, and style reading. It supplies data-manager and scale
defaults. Labels, dividers, browser input, and observers are optional
collaborators. Without a scheduler it uses immediate rendering.

[browserDeps](../packages/dom/src/browser-deps.ts) binds collaborators to a
container and supplies browser defaults, including animation-frame scheduling.
[createPlotModel](../packages/core/src/plot/model.ts) instead assembles the same
`Plot` with memory layers and a recording renderer. Headless execution is a
wiring choice, not a separate chart implementation.

React's [usePlot](../packages/react/src/hooks/use-chart.ts) creates and destroys
the plot through effects. The initial `deps` is read at mount; later props
update the existing chart. Changing assembly requires a remount. Preserve
StrictMode cleanup and subscription behavior when changing this layer.

## Choosing where a change belongs

- Data validity, merging, or computations: `data`, then `registration` for
  registration-specific behavior.
- Coordinate transforms: `scale`; calendar rules: `time`.
- A new representation: `series`, or its extension package.
- Layout and chart-wide coordination: `plot`.
- Browser event or element behavior: `dom`.
- React lifecycle or declarative reconciliation: `react`.
- A separately installable capability: a plugin using narrow host contracts.

Follow [Data flow](data-flow.md), [Rendering](rendering.md), and
[Extensions](extensions.md) for the corresponding implementation paths.
