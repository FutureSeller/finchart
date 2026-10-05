# Extending the engine

Choose the narrowest contract that describes the feature. A new indicator,
drawing tool, or representation should not require a new chart-wide method
unless the existing contracts cannot express its behavior. Preserve explicit
imports and assembly so consumers can omit unused code.

## Extension paths

| Feature | Contract and implementation owner |
| --- | --- |
| New representation of points | `Series<T>` in [series/types.ts](../packages/core/src/series/types.ts) |
| Calculation with reusable branches | `Source` and [computation.ts](../packages/core/src/data/computation.ts) |
| Drawing tied to a plot or pane | [decoration.ts](../packages/core/src/plot/decoration.ts) |
| Installation, state, subscriptions, cleanup | `Plugin<Host, Api>` and [plugin.ts](../packages/core/src/primitives/plugin.ts) |
| Gesture ownership before default pan | [input-router.ts](../packages/core/src/interaction/input-router.ts) |
| Custom rendering primitive | `CustomDraw`, `drawCustom`, and a supplied canvas painter |
| Browser element or observer | `packages/dom` or a browser-specific plugin |
| React attachment | `packages/react` hooks or components over the same core contracts |

## Adding a series

A series describes its value extent and emits commands through `draw`. It can
also supply coordinate accessors, decimation policy, and readout descriptions.
The representation is stateless; registration owns its data and identity.

Use `SeriesContext.x` for x placement and `yScale` for values. If cached screen
positions are available, use `screenXAt` rather than directly reading `places`.
The series neither chooses the chart's layout nor manages input or DOM nodes.
When drawing style is configurable, declare a spec and resolve it using the
context's style reader.

Start from [line-series.ts](../packages/core/src/series/line-series.ts) or a
representation with similar geometry. Verify empty data, whitespace, finite
extreme values, value extents, coordinate accessors, and command output. The
[custom series example](../apps/docs/examples/custom-series.md) demonstrates a
consumer implementing the contract.

## Adding a computation or indicator

Keep numeric kernels separate from chart attachment. Reusable outputs are
sources passed by value, so one branch can feed another computation or several
series without a global name registry. Select a full-calculation baseline
before adding incremental paths.

[factories.ts](../packages/indicators/src/factories.ts) and
[fold-node.ts](../packages/indicators/src/fold-node.ts) show the indicator
construction pattern. Preserve warmup output, gaps, optional volume semantics,
and equivalence between full and incremental calculation. History followed by
a live tick is a distinct sequence worth checking, not just another append.

For a public indicator, update named exports and its package documentation.
[indicators-matrix-check.mjs](../scripts/indicators-matrix-check.mjs) validates
documented factories and defaults. See [Data flow](data-flow.md) for ownership
and cache rules and the [user guide](../apps/docs/guide/extensions.md) for usage.

## Plugins and decorations

A decoration describes drawing; a plugin packages installation and lifetime.
A plugin can install decorations, data registrations, input consumers, and
subscriptions. Its host type should be the intersection of the capabilities
it actually uses, drawn from
[capabilities.ts](../packages/core/src/plot/capabilities.ts).

`plot.use(plugin)` and `pane.use(plugin)` return the plugin's API as-is.
They do not merge methods onto the host. Prefer `pluginApi(api, cleanup)` or
`teardown(cleanup)` for idempotent disposal and observable `disposed` state.
Never spread a teardown API into another object: that copies the current value
of its getter instead of preserving live lifecycle state.

Register cleanup beside acquisition. A
[Scope](../packages/core/src/primitives/scope.ts) is useful for multiple
subscriptions or nested gestures: it disposes in reverse order, continues
through cleanup failures, and immediately releases resources added after it
has closed. Installation and callbacks can re-enter the host, so account for
the host being removed or destroyed during setup.

Configurable plugin options use a shallow patch contract. Supplied fields
replace their prior values; explicit `undefined` resets a field to its default.
Applying options after disposal throws. Keep that distinct from an API whose
options are fixed at installation.

The guards include [plugin.test.ts](../packages/core/src/plot/__tests__/plugin.test.ts),
[pane-plugin.test.ts](../packages/core/src/plot/__tests__/pane-plugin.test.ts), and
[plugin-options.test.ts](../packages/core/src/plot/__tests__/plugin-options.test.ts).

## Input consumers and painters

The input router visits consumers by descending priority, with later
registration first on a tie. A consumer that captures a pointer owns its
continuing events until release or cancellation. An extension must release its
capture and cursor resources on cancellation and disposal. Browser event
translation belongs to [pointer.ts](../packages/dom/src/pointer.ts); core
routing is also usable without a browser.

Custom painters are supplied to `createCanvasRenderer`, not globally registered.
Provide a fallback for surfaces that cannot replay a custom primitive. Use the
canvas property validation helpers and handle platform exceptions inside the
painter where an intentional fallback is possible. See
[Rendering](rendering.md) for command and clipping boundaries.

## Completing an extension

1. Define the interface and observable behavior, then write the relevant tests
   before implementation, following [PRINCIPLES.md](../PRINCIPLES.md).
2. Keep the implementation in its owning module or package and test actual
   substitution of the extension contract.
3. Add a runnable example in `apps/examples`, including removal or teardown.
4. Export public names deliberately and update consumer documentation.
5. Check types, lifecycle regressions, package boundaries, and the affected
   bundle scenario. Use the full [development gate](development.md) before
   committing the completed feature.
