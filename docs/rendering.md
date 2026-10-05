# Rendering, styles, and frame lifetime

The chart's inspectable output is a draw-command list. Canvas playback and DOM
overlays are environment-specific consumers of the settled chart state.
Layout, command generation, and playback have separate responsibilities.

## Scheduling and synchronous state

State-changing methods update chart state synchronously and request rendering.
The injected scheduler determines when that request draws:

- `immediateScheduler` draws during the request. It is the assembly fallback
  and the default for headless models.
- `frameScheduler` coalesces requests into the next animation frame. Browser
  assembly supplies it; it falls back to immediate scheduling without rAF.
- `manualScheduler` lets a test or caller explicitly flush requests.

[scheduler.ts](../packages/core/src/render/scheduler.ts) defines these contracts.
`Plot.render()` draws now, cancels the pending scheduled frame, and blocks
recursive entry while already rendering. Do not assume a request made from a
draw callback recursively produces another frame with immediate scheduling.

## One render pass

The implementation is `renderFrame` in
[plot.ts](../packages/core/src/plot/plot.ts):

1. Cancel the pending scheduled render, resize layers, and clear accumulated
   renderer commands.
2. If there is no data range, clear stale labels and divider handles, commit
   the empty frame, and emit the render notification.
3. Convert the mapping domain into a data-x viewport and update visible value
   extents for automatic value axes.
4. Create one style reader for the frame.
5. Settle geometry with [frame.ts](../packages/core/src/plot/frame.ts): pane
   heights and y ticks first, y-axis width next, then pane areas, x range,
   and x ticks. A frame without usable space takes the empty cleanup path.
6. Generate commands and overlay descriptions through
   [painter.ts](../packages/core/src/plot/painter.ts).
7. Commit renderer output and emit the render notification.

Layout may call user formatters or measurers. Its pane list is copied so ticks
remain paired with the scene they were laid out for. Painting skips panes that
have since left the chart; panes added during a callback belong to a later
frame. Preserve this identity relationship when changing traversal.

## Paint order and clipping

The painter nests plot decorations around pane drawing. Pane drawing contains
its own decorations and series. Decorations can be below or above series;
ordering belongs to their stores, not a global canvas/DOM z value.

The stage assigns clip boundaries: plot decorations receive the whole data
area, while each pane's drawing receives its slice. Axis labels and badges are
rendered after releasing the data clip. A series must not introduce ownership
of another pane's geometry to prevent spillover.

Axis labels and dividers are optional collaborators. Browser assembly uses
DOM implementations; headless models use command-producing axis labels. The
absence of labels affects reserved layout space, not just visibility.

## Commands and custom playback

[render/types.ts](../packages/core/src/render/types.ts) defines `DrawTarget`,
`Renderer`, and the `DrawCommand` union. A series needs drawing methods, not
the renderer's `clear` and `commit` frame boundaries. Adding a command variant
affects consumers that exhaustively inspect the union; treat it as a public
contract change.

[CanvasRenderer](../packages/core/src/render/canvas-renderer.ts) collects
commands and replays them on commit. Clearing its command list alone does not
erase the visible bitmap. An empty frame still needs a commit to remove the
previous picture.

Use `drawCustom(target, draw)` for custom commands. It replays fallback commands
when the target lacks custom drawing support. A canvas renderer receives its
custom painters through assembly; there is no global painter registry.
Fallback commands cannot own clipping. Keep custom parameters serializable
when the extension is intended for a worker or transport boundary; `unknown`
parameters do not enforce that property at runtime.

## Style resolution

The owner declares a `StyleSpec`; `resolveStyle` derives defaults and resolves
overrides and style-reader values. Resolution precedence is a supplied
override, then the CSS value, then the fallback. Nullish overrides mean no
override. Numeric leaves enforce parsing, units, and declared ranges; string
leaves such as colors are validated at their playback boundary.

[style-spec.ts](../packages/core/src/render/style-spec.ts) owns these rules.
The browser [cssReader](../packages/dom/src/css-reader.ts) captures computed
style for the frame. Series receive a reader rather than a DOM element.
DOM overlays may let the browser resolve CSS variables directly; canvas
commands carry resolved values.

Canvas can silently reject an invalid property assignment and retain a prior
value. Built-in playback uses `applyColor` and `applyFont` to avoid borrowing a
neighboring command's style. Custom painters must preserve the same checks.
See [gradient.ts](../packages/core/src/render/gradient.ts) for a concrete painter.

When adding a style property, update its owning spec, the
[public theme reference](../apps/docs/guide/theme.md), and the relevant checks in
[style-vars.test.ts](../packages/core/src/__tests__/style-vars.test.ts).
Shared fallback consistency is also checked by
[style-vars-check.mjs](../scripts/style-vars-check.mjs).

## Pixel units and teardown

Layout, pointer input, and scale ranges use CSS pixels. Browser
[layers](../packages/dom/src/dom-layers.ts) scale the backing store by device
pixel ratio and restore the context transform after changing canvas dimensions.
Changing DPR must not change the coordinate space visible to chart logic.

`Plot.destroy()` cancels scheduling, stops event notifications, releases
plugins and panes, and disposes acquired collaborators. Cleanup continues
after failures and reports them afterward. Resource scopes release in reverse
acquisition order; explicit teardown phases preserve chart-specific ordering.
See [scope.ts](../packages/core/src/primitives/scope.ts) and
[scope-injection.test.ts](../packages/core/src/plot/__tests__/scope-injection.test.ts).
