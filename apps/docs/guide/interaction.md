---
description: "Mount @finchart/tools, the input stack it sits on, and the keyboard contract — Esc cancels, Delete removes, and why the chart element has to keep focus."
---

# Turning on the drawing tools

Read this guide if you want to mount drawing tools — trend lines, horizontal
lines — onto the chart, or blow a pane up to full screen with a double-click.

The drawing tools and `paneMaximize` are not core; they are extensions mounted
on top of core — both use the same plugin contract as
[Building your own indicator](./extensions). This page shows what interaction
vocabulary those extensions hand your users.

## Drawing tools

```ts
import { drawingTools } from "@finchart/tools";

// Mount onto a pane — a drawing lives by that pane's value axis. `plot` comes
// separately, for x and the input stack.
const tools = plot.mainPane.use(drawingTools({ plot }));

tools.add({ type: "horizontal", price: 105 });
tools.select(handle); // select programmatically
tools.select(null); // clear the selection
tools.clear(); // erase everything
tools.undo(); // one committed add/remove/update/drag
tools.redo();
```

`canUndo()` / `canRedo()` answer button state, including an in-flight draft or
drag, and `historyChanges` announces when to read them again. A drag becomes one
command on release. `clear()` and a successful `load()` replace a document and
empty both stacks.

A full running example — down to the clear-selection, delete and erase-all
buttons — is in [Drawing tools](/examples/drawing). Saving drawings across
sessions — `serialize()` / `load()`, keyed by symbol and interval — is in the
[`@finchart/tools` README](https://github.com/finchart/finchart/tree/main/packages/tools#saving-per-symbol-and-interval).

### `paneMaximize` — one pane fills the chart

```ts
import { paneMaximize } from "@finchart/core";

const maximize = plot.use(paneMaximize({ gestures: true }));
```

`gestures: true` is **opt-in** — double-clicking a pane is already taken by
`doubleClickReset` and used to reset to the full view (on by default — for the
table see the interaction options table in
[the Plot contract](/guide/plot-contract#interaction-—-what-works-and-how-to-turn-it-off-and-on)). If maximize ate
the same gesture by default, that reset would die quietly on every pane
click — which is why you turn it on explicitly.

::: warning Using it alongside the drawing tools — **install order** decides who owns the double-click
`paneMaximize` with `gestures: true` and the drawing tools **both watch
dblclick.** Whether a double-click on a shape picks the shape or maximizes the
pane comes down to this: at equal priority, **whoever registered last wins**
(on a tie the input stack asks the later registration first).

So mount the drawing tools **later** and the shape wins; mount them first and
maximize wins. `Esc` (clear the selection vs. restore from maximize) splits on
the same order. `paneMaximize` takes no priority option today, but **the
toolbox does** — pass `drawingTools({ plot, priority: 1 })` and the tools get
it first regardless of install order (measured). So there are two levers — the
toolbox has a `priority` option, `paneMaximize` still has only install order.
:::

## The keyboard contract

**The container element** (the one you passed to `build()`) **always** takes
focus (`tabIndex 0`) — not the canvas. `keyboard: false` does not turn
that focus off either; what that option turns off is the two "core" rows in the
table below. To pull it out of the tab order entirely, give that element
`tabindex="-1"` yourself.

**And the name is the caller's to give.** Core makes that container a tab stop
but hands it neither a name nor a role — because core does not know **what**
your chart draws. Leave it off and what a screen reader user arrives at is an
unnamed container.

```html
<div id="chart" role="img" aria-label="AAPL daily candles, January to June 2024"></div>
```

The full contract is in
[plot-contract's keyboard controls (accessibility)](/guide/plot-contract#keyboard-accessibility) —
**this side is a summary of that section.** `keyboard: false` does not reach as
far as `tabIndex` — because `pointer.ts` attaches `tabIndex` **outside** the
option branch.

| Key | What it does | Owner |
|---|---|---|
| `←` `→` | pan by 5% of the visible width | core |
| `+` `−` | zoom about the center | core |
| `Esc` | cancel the drawing → undo the drag → clear the selection (in that order) | drawing tools |
| `Esc` | (when the drawing tools have nothing to drop) restore the maximized pane | `paneMaximize` |
| `Delete` `Backspace` | delete the selected drawing | drawing tools |
| `]` `[` | cycle the drawing selection (next/previous, wraps at the ends) | drawing tools |
| double-click a pane | toggle maximize on that pane | `paneMaximize({ gestures: true })` |
| `↑` `↓` (with Shift, 40px) | move a focused pane divider 8px | pane divider |
| `Home` `End` | move a focused pane divider to its limit | pane divider |

The divider rows belong to the handle between panes, which is a tab stop of
its own; the keys it handles stop there and never reach the container.

Ctrl/⌘+Z does not pass through this table yet: the DOM host deliberately keeps
modified keys outside the normalized input stack. Bind it on the chart element
and call `tools.undo()` / `tools.redo()` directly. That recipe is unambiguous
with one toolbox; with one toolbox per pane, the application must choose its
active pane because the toolbox's cursor-based keyboard owner is private.

**The owner is whoever contends under the cursor.** Mount one drawing-tools
instance per pane and `Delete`, `]` and `[` belong to **the pane the cursor
last crossed**. Over a spot where nobody contends — an axis, a margin, an
indicator pane with no toolbox — **the last owner stays the owner**: going to
the axis to read a price label and then hitting Delete is a normal path. Only
`Esc` skips this verdict (it is the escape key — press it anywhere and
whatever you were doing ends).

**Right-click picks but does not eat** — on a line it selects that line, on
empty space it clears the selection (same rule as the left button). And it
returns `false`, so the `contextmenu` event still fires. Your app reads
`tools.selection()` inside it and builds the menu:

```ts
plot.on("contextmenu", ({ position }) => {
  const target = tools.selection();   // the drawing under the cursor, null if none
  openMenu(position, target);
});
```

**We do not block the native menu.** `@finchart/dom` calls `preventDefault`
**only when** a consumer ate the event, and the toolbox deliberately does not
eat it — so your app has to attach a `contextmenu` listener on its own
container and block it there. Leave it unblocked and the browser menu comes up
on top of your app's menu.

A key passes through
[the input stack](/guide/plot-contract#interaction-—-what-works-and-how-to-turn-it-off-and-on)
once — if a consumer does not eat it, it moves on to the next. Who owns `Esc`
is decided by the same rule as the warning above (mounted later, asked first).
A key nobody ate goes to core's pan/zoom. Nobody takes `Tab` — moving focus
belongs to the browser.

To do the same thing programmatically, mimic the real key input —
`routeInput` goes through the input stack unchanged, so it is the same path a
genuine keyboard event takes.

```ts
plot.routeInput({ type: "keydown", key: "Delete" });
```

## Why the two vocabularies are separate extensions

The drawing tools and `paneMaximize` need not know about each other — the two
negotiate over a single `Esc`, and only through the chain. That they landed
with no core commit is itself evidence that this negotiation needs nothing
but extension-side wiring. The design case for narrowing a requirement with
capability interfaces is in
[Building your own indicator](./extensions#capability-interfaces-—-ask-for-exactly-as-much-as-you-need).
