# @finchart/tools

Drawing tools — horizontal and vertical lines, trend lines, rays, extended
lines, arrows, Fibonacci retracements and extensions, rectangles, ellipses,
price and bar measures, parallel channels, pitchforks. A drawing is pure
data in domain coordinates (data x and price), so serializing one carries it
across sessions, and dragging beats panning because it sits on top of the input
stack's capture. Also built with zero commits to core.

## Install

```sh
pnpm add @finchart/tools @finchart/core
```
`@finchart/core` is a peer — install both.

## Mounting

**Attach to a pane**, because a drawing lives on that pane's value axis
(price). `drawingTools` takes `plot` separately because the x coordinate system
and the input stack belong to the stage, not the pane.

```ts
import { drawingTools } from "@finchart/tools";

const tools = plot.mainPane.use(drawingTools({ plot }));

tools.begin("trend");                            // the next two clicks draw a trend line
tools.begin("pitchfork");                        // three clicks — one per anchor
tools.add({ type: "horizontal", price: 105 });   // add one programmatically
tools.dispose();                                 // tears down all the wiring at once
```

**Editing works by hand too** — select a drawing and its endpoint handles
appear, and the drawing itself is drawn one pixel heavier than its
neighbors (its own color and dash, just bolder — handles alone vanish in a
crowd); drag a handle and only that point moves (a horizontal line has one
center handle that moves the whole thing). When two handles sit on top of
each other — a line zoomed down to a few pixels — the **nearest** one is
grabbed, so both ends stay reachable. Esc cancels, Delete removes, and
`]` / `[` cycle the selection. **The crosshair keeps reading** while you
draw or drag: the toolbox consumes those pointer moves, and would otherwise
switch the chart's crosshair off for exactly the moves where you're reading
prices, so it drives the crosshair itself (that's why the stage needs a
`crosshair(position)` — `Plot` has it).

**A drawing you finish by hand is selected on completion; one added with
`add()` is not.** The asymmetry is deliberate. Hand-drawing is something the
user's hand just finished, so their intent is right there. `add()`, on the
other hand, **fires without any user intent at all** — an alert line pushed
from a server, a batch of drawings restored on mount. If it always selected the
new drawing, it would steal a selection the user was editing, and the page
would open with handles on a shape nobody drew.

When the user **did just press a button**, you can finish the same way
hand-drawing does:

```ts
tools.add({ type: "horizontal", price: 105 }, { select: true });
```

**Selection changes are announced** — this is what a properties panel or a
trash button listens to. Pointer clicks, double-clicks, right-clicks, `]`,
`[`, `select()`, and deselection all arrive here.

```ts
tools.selectionChanges.subscribe(({ selection, handle }) => {
  panel.show(selection);          // a copy — null when nothing is selected
  trashButton.disabled = !handle; // the handle is the identity
});
```

**Undo and redo count committed edits, not pointer frames.** A whole drag is
one command when the pointer is released; `add`, `remove`, and `update` are one
command per call. Undoing a selected removal restores that same object and its
selection, so existing handles keep working. `clear()` and a successful
`load()` are document boundaries and empty both stacks — use them to replace a
ledger, not for an undoable "remove all" action.

```ts
const syncHistory = () => {
  undoButton.disabled = !tools.canUndo();
  redoButton.disabled = !tools.canRedo();
};

tools.historyChanges.subscribe(syncHistory);
undoButton.addEventListener("click", () => tools.undo());
redoButton.addEventListener("click", () => tools.redo());
syncHistory();
```

During a drag, `undo()` cancels the unreleased move first. During a multi-point
draft it removes the last confirmed anchor before reaching the command stack;
an armed tool has no draft, so undo reaches history normally. `redo()` declines
while a draft or drag is in flight.

The `handle` is the point. With only the value, an app **can't tell two
identical drawings apart** (two horizontal lines at the same price) — the
cursor pointed at the one drawn on top, but a lookup by value finds the one
underneath.

> **Keys only arrive while the chart has focus.** If you turn a tool on from a
> toolbar button, focus moves to that button — so after turning it on you have
> to **give focus back** to the element you passed to `build()`, or those four
> keys are dead and the Esc a user presses after changing their mind does
> nothing. It's one line:
>
> ```ts
> button.addEventListener("click", () => {
>   tools.begin("trend");
>   chartEl.focus();   // the element you passed to build()
> });
> ```
>
> The full story is under "Keyboard" in [plot-contract.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/plot-contract.md).

Ctrl/⌘+Z is deliberately not built into the chart input stack yet: modifier
keys are kept by the DOM host. In a **single-toolbox** chart, bind the DOM key
and call the API directly:

```ts
chartEl.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
  const used = event.shiftKey ? tools.redo() : tools.undo();
  if (used) event.preventDefault();
});
```

With one toolbox per pane, the application must call undo on its active pane's
toolbox; the private cursor-ownership decision used by Delete is not a public
API. Built-in modified-key routing reopens when core and the DOM host carry
modifiers together.

**Snapping** — `drawingTools({ plot, snap: true })` or `api.setSnap(on)`.
Drawing and endpoint dragging snap to bar values (close, low, high) and bar x,
but only within `snapRadius` (8px by default), and moving a whole drawing never
snaps (it keeps its relative layout). Off by default. When an anchor actually
sticks, a small ring is drawn around it — so "did it snap?" is never a guess. The candidate values come
from the core accessor's `getYRange` (a point's **data** value span) — so a
custom series only has to supply that for snapping to understand it.

**Serialization comes in two layers.** The top layer is for apps:
`tools.serialize()` turns every drawing on the stage into a string, and
`tools.load(s)` restores it (returns false if it can't parse the string, and
keeps the existing list). The lower-level `serializeDrawings` /
`parseDrawings` (drawing array ↔ string) is for apps with their own storage
format or partial saves. You only need one of the two, and usually it's the
top layer. For when to save, subscribe to `tools.changes`:

```ts
tools.changes.subscribe((change) => {
  if (change.reason !== "move") saveDrawings();
});
```

Drag-moves arrive separately with `reason: "move"` so you can debounce just
those; every other reason is a discrete edit worth saving. `update` fires
once per `handle.update` call — if you drive it from a spinner or a slider,
the debounce belongs on your side, the same as `move`. Every notification also
carries `via: "direct" | "undo" | "redo"`, so a host-level command stack can
ignore a drawing-history replay instead of recording it again. Notifications
(`changes`, `selectionChanges`, `modeChanges`, `historyChanges`) are delivered
synchronously after the internal mutation finishes, **before the originating
call returns**, in the order the state changed. A subscriber must use its event
payload rather than a variable awaiting that call's return value. Thus
calling back into the toolbox from a subscriber (`clear()` from a selection
listener, `undo()` from a change listener) is safe, and a mirror that replays
the events lands on the same state as `list()`. There's a working
example in the
[drawing tools case](../../apps/examples/src/cases/drawing.ts), which does a
localStorage round trip.

**Every drawing carries a stable `id`.** It's minted at the door (`add`, or
the moment hand-drawing completes) — you never invent one — and survives
save/load, so a side panel can key its own state by it. `handle.update(patch)`
edits a drawing in place (geometry, per-drawing `style`, a Fibonacci's
`levels` — a retracement defaults to `FIB_LEVELS`, an extension to
`FIB_EXTENSION_LEVELS`, and neither clamps a level you set); a key
passed as `undefined` returns that field to its default — `style: undefined`
goes back to the theme. Per-drawing `style` uses the same
`Partial<LineStyle>` leaves as the toolbox override (`width` · `color` ·
`dashArray`), and the values are literals: a drawing you colored by hand
keeps its color across a theme switch, deliberately.

**A Fibonacci can space its levels in log price** — `levelSpacing: "log"` on a
retracement or an extension, set through `add` or `handle.update`
(`levelSpacing: undefined` goes back). Levels are evenly spaced *in price* by
default, so on a log axis they bunch toward one end — the 50% line of a
160,000 → 380,000 retracement sits a tenth of the swing off the visual middle.
Log spacing puts level `l` at `b·(a/b)^l` (an extension: `c·(b/a)^l`), which is
what looks even there.

It belongs to the **drawing, not the axis**: the arithmetic needs only the
anchors' prices, so a saved drawing puts its lines at the same prices whatever
axis shows it — toggle the axis and nothing jumps. (TradingView's option of the
same name takes effect only while the chart is on a log scale; this one does
not look at the scale, on purpose.) The other side of that: on a *linear* axis
log-spaced levels are the ones that bunch, and their percent labels can overlap.
A body drag moves a log-spaced drawing by a common factor rather than a common
amount, so the level you grabbed stays under the cursor — when a factor is
possible: every anchor's price, and the cursor's where it grabbed, is positive.
Otherwise the whole gesture moves by a common amount, like any other drawing.
During such a drag, a move log price cannot express is not applied — the cursor
at a price that is not positive, an anchor that would leave the doubles, or two
different anchor prices that would land on the same one — and the drawing waits
where it last was until the cursor comes back to a price it can follow.

Log price needs positive prices. While an anchor's price is zero or below, the
levels log spacing cannot define are **not drawn** — never drawn somewhere else:
the anchors' own levels (a retracement's 0% and 100%, an extension's 0%) stay
defined, so those lines remain where the level list has them and the axis shows
their prices, until the prices are positive again. The same goes for a level
whose price would leave the doubles. A saved drawing whose `levelSpacing` this
build does not know loads with the default spacing — that one field is dropped,
like a field it does not know, and every other drawing loads as usual.

**Hand-drawn Fibonaccis are born with `defaults`** —
`drawingTools({ plot, defaults: { fib: { levelSpacing: "log" }, fibExtension: { levels: [0, 1, 1.618] } } })`.
A drawing made with the pointer is otherwise just its anchors, so this is how a
hand gets log spacing or a level list of its own. It applies to hand-drawing
only: `add` takes exactly what you give it, and `update({ levels: undefined })`
returns to the built-in list, not to this. The option is read once.

**The two measures carry a label** on their segment's midpoint — a price
measure reports the move from `a` to `b` (delta in the pane's own format,
plus the percent when `a` isn't zero), a bar measure the number of bars
between them — the pane's nearest bar at each end, counted by index, so a
gap between bars counts as what it is and the count is the same under a
time axis and a bar-index one. Without any bars there is no count, so no
label. The label's box wears
the drawing's color and its text `--chart-drawing-label` (light by
default, the same inverted pair as the crosshair badge). The label is
presentation only: the segment is what you grab.

## Saving per symbol and interval

One key for every chart puts BTC's trend line on AAPL. Drawings belong to
the same identity the data was fetched for — symbol and interval — so key
the saved string by that identity, and mind the order: **save the old,
switch, then load the new or clear.**

```ts
interface ChartIdentity { symbol: string; interval: string }
const keyOf = ({ symbol, interval }: ChartIdentity) => `drawings:${symbol}:${interval}`;
let current: ChartIdentity = { symbol: "BTC-USD", interval: "1m" };

// Restore the identity you start on before anything is saved — the first
// save below would otherwise write an empty stage over what was there.
if (!tools.load(localStorage.getItem(keyOf(current)) ?? "")) tools.clear();

function switchTo(next: ChartIdentity): void {
  localStorage.setItem(keyOf(current), tools.serialize());
  current = next;
  if (!tools.load(localStorage.getItem(keyOf(next)) ?? "")) tools.clear();
}
```

Two things the order protects. The initial `load()` comes before any save:
the stage starts empty, and a save-then-switch that ran first would write
that empty stage over the drawings already stored for the starting identity.
And the `clear()` is not decoration. `load()` returns `false` for an empty or
unreadable string and **leaves the stage as it was** — without the clear,
switching to a symbol you never drew on would keep the previous symbol's
drawings on screen, the very failure the key was meant to prevent. A
successful `load()` and `clear()` both replace the document and empty the
undo history, so a switch is a boundary undo does not cross; a failed
`load()` changes neither.

What the key needs to carry:

- **The symbol**, always.
- **The interval.** An anchor's x is a data x — on a time axis, an instant
  — so a line drawn on 1-minute bars lands on the same instants on daily
  bars, but it is not re-snapped to the daily bars' closes (snapping is what
  the magnet does while you draw). Keying by interval is what most apps
  mean.
- **Not the coordinate system.** `continuousX` and `barIndexX` both hand the
  tools a data x, so the same saved drawings load under either.
- **A price-axis transform's parameters and source**, when one is on. Renko
  and its kind produce an ordinal x that is only meaningful for one
  (transform, options, source) triple — the
  [plot contract](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/plot-contract.md)
  says how to restore across that boundary, and it is best effort.

## Pointing at what you restored

`serialize()` / `load()` carry drawings **across sessions**. Restored drawings
are addressed with `handles()`, in the same order as `list()`.

```ts
tools.load(localStorage.getItem(KEY) ?? "");

// A side panel: clicking row n highlights that drawing on the chart
const handles = tools.handles();
row.onclick = () => tools.select(handles[n]);
handles[n].remove();
```

Handle objects are created fresh on every call — the contract is **what they
point at**, not their identity, so `select` and `remove` work just the same.
Two vocabularies, two jobs: the `id` is **yours** (key your own store or
panel rows by it), the handle is how you call **us** (`select` / `remove` /
`update`).

## How close you have to click

Hit-testing distances are **fixed in pixels** — zoom and screen density don't
change them.

| What | Distance | |
|---|---|---|
| A line (trend line body · horizontal line · Fibonacci level · a measure's segment · either channel line · a pitchfork's rays and bar) | **4px** | |
| A shape's boundary (rectangle · ellipse) | **4px** | The interior is **not** grabbable — a click inside still pans |
| An endpoint handle (`a` · `b` · `c`) | **6px** | Generous on purpose — **endpoints win over lines** |

Endpoints having the wider radius is deliberate. If lines won where the two
overlap, you could never grab an endpoint — and dragging to change a line's
length would be dead entirely.

**These are hit-test distances, not styling, so they aren't CSS variables.**
They're in the same family as snapping's `snapRadius` above — an assumption
about the accuracy of a human hand, not something you see. They
aren't exposed as options today: if real reports of *"I can't grab the
handles"* on touch come in, that's when `hitRadius` opens up.
Until then they're documented here, because **you still need the numbers to size
your own UI around them.**

## Support matrix

- **Node 20.19+** — where the headless path (SSR, workers, tests) runs; CI runs that floor.
- **Browsers — Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03).
  The floor is set by `structuredClone`, `Object.hasOwn`, and
  `Array.prototype.at`, and **no polyfills ship** — bring your own if you need
  to support something older.
- The repository's own toolchain (Node 24.21+ · pnpm 12) is higher than this. That
  is **the contributor's floor**, not the consumer's.

## Docs

- **Style tokens** — the full CSS variable table — [`theme.md`](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/theme.md)
- **The Plot contract** — [plot-contract.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/plot-contract.md)
- **Glossary** — [glossary.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/glossary.md)
- **Saving per symbol and interval** — [above](#saving-per-symbol-and-interval)
- **Time zones and sessions** — [time-zones.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/time-zones.md)
