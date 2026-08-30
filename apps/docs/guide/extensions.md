---
description: "Write an indicator against the same contracts the built-in ones use: derived series, computation nodes that compute once and feed many drawings, and custom draw commands."
---

# Building your own indicator

If you want your own indicator or drawing tool to snap in and out like a
package, it helps to know first that there are already cases that started from
exactly the same place.

`@finchart/indicators` and `@finchart/tools` were built with **zero core
commits** — 17 indicators and three drawing tools, all of them built on
contracts core had already published. This page shows those contracts. So a
third party can start from the same place.

## A plugin — one function, one dispose

```ts
type Plugin<Host, Api extends PluginApi = PluginApi> = (host: Host) => Api;
interface PluginApi {
  dispose(): void;
  readonly disposed: boolean;
}
```

```ts
const api = pane.use(drawingTools({ plot })); // install
api.dispose(); // tear down — all the wiring at once
```

There are both `plot.use()` (attaches to the chart) and `pane.use()` (attaches
to a pane) — the test is **what it attaches to**. An extension that has to
create a new pane (an indicator with its own pane, like MACD) needs
`PaneHost`, so it is the chart's; an extension that only mounts onto an
existing pane (moving average, Bollinger) is that pane's. Remove a pane and
the extensions attached to it are cleaned up with it.

## `disposed` is not optional

```ts
interface PluginApi {
  dispose(): void;
  readonly disposed: boolean; // required
}
```

For the chart to let go of a dead plugin, and for a torn-down plugin to block
calls against itself — both need this flag visible from outside. Don't
implement it yourself; use one of the two helpers.

```ts
import { pluginApi, teardown } from "@finchart/core";

// an API that is nothing but teardown
return teardown(() => {
  handle.dispose();
  unsubscribe();
});

// an API with methods of its own
return pluginApi({ node, pane: paneApi }, () => {
  handle.dispose();
  disposeOwned();
});
```

**Do not merge with a spread** (`{ ...teardown(fn), node }`). A spread copies
the `disposed` accessor as its value at that instant (`false`), which builds an
API that answers "alive" forever, even after cleanup — and the chart's
housekeeping and the plugin's own guard both run on top of that lie.

## Capability interfaces — ask for exactly as much as you need

Narrow a plugin's signature from `Plugin<Plot>` down to a type holding only the
capabilities it actually uses. `Plot` `implements` all of them, so the compiler
keeps the pairing honest.

| Extension | Capabilities required |
|---|---|
| `crosshair` | `DecorationHost & RenderRequester & PlotEventSource` |
| `legend` | `OverlayHost & PaneHost & PlotEventSource` |
| `tooltip` | `OverlayHost & PlotEventSource & FormatSource` |
| `syncX` (both) | `PlotEventSource & ViewportControl` |
| `@finchart/indicators` | `PaneHost` (most take the narrower `SeriesHost`) |
| `@finchart/tools` | on the pane side `PaneDecorationHost & ValueCoordinates & DataProbe`, the chart optionally — `RenderRequester & InputHost & XCoordinates & CursorHost & FocusAreaHost` |

Why narrower is better shows up in the tests — run the plugin against a
minimal fake host instead of a whole `Plot` and you catch on the spot whether
it is demanding capabilities it never uses. Do not build a monolithic context
type like `PlotContext` — build one and every extension gathers there, and it
becomes a single coupling point where changing any one thing breaks all of
them.

## Computed nodes — compute once, feed several drawings

MACD is not one line but three (macd, signal, histogram). Compute each branch
separately and you run the same EMA three times. `computation` takes both its
inputs and its outputs as **values** — nothing is referenced by name.

```ts
import { computation } from "@finchart/core";

const price = pane.addSeries({ series: candleSeries(), data: candles });

const macd = computation({
  inputs: [price], // values — not string ids
  calc: (candles) => ({ macd, signal, histogram }), // branch names come from the return type
});

lower.addSeries({ series: lineSeries(), input: macd.out.signal });
lower.addSeries({ series: lineSeries(), input: macd.out.histogram });
```

What value references buy you: a typo (`macd.out.signl`) becomes a compile
error, and since you cannot reference what does not exist, a cycle is
structurally impossible. The price is that it does not serialize — but the
state worth saving is the view state (pan and zoom position), not "what is
being drawn", so that price never comes due in the first place.

The names without `attach` — `rsi()` and `macd()` in `@finchart/indicators` —
return exactly this computed node. The full naming rules are in
[The grammar of names](/reference/naming).

## Reconfiguring — don't unmount and remount

Switch a plugin off and on again to change one option and an extension that
holds state — the drawing tools, with the lines you drew — loses all of it.
Put a reconfigure method of your own on the API that `use` returns and the
problem never arises — `applyOptions` on `crosshair`, `tooltip` and `legend`
is that shape. Core forces no name — the extension's author picks one that
fits their API.

**Not that every extension should.** The indicators deliberately went the
other way: what `attachRsi` returns is nothing but `{ node, pane }` plus
`PluginApi`, with no `period` setter. The road to changing a parameter is
**reinstalling** — `dispose()`, then `use()` again with new options
(`@finchart/indicators`'s README says the same). Because a computed node is a
value, rebuilding it is cheap, and because there is no state, there is nothing
to lose.

## Styling

An extension that draws takes part in the same theming system as the
built-in series — declare a spec, resolve it through `context.readStyle`.
The recipe lives in [Theming](/guide/theme#styling-your-own-extension).

## A minimal example

The real source of `@finchart/indicators` shows how small this contract is —
`attachRsi` is one computed node (`rsi()`) plus one series registration plus
own-pane wiring, and that is all of it. The full source opens straight from
the GitHub link in
[attachRsi in the API Reference](/api/@finchart/indicators/functions/attachRsi).

```ts
export function attachRsi(
  options: AttachRsiOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Rsi>> {
  return (plot) => {
    const node = rsi(options.source, { period: options.period });
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, (owned) =>
      wireOscillatorPane(owned, options.levels, { overbought: 70, oversold: 30 }),
    );

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.rsi,
      name: `RSI(${options.period ?? RSI_DEFAULTS.period})`,
      color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}
```
