# @finchart/tools

Drawing tools — horizontal and vertical lines, trend lines, rays, extended
lines, arrows, Fibonacci, rectangles, ellipses, price and bar measures,
parallel channels, pitchforks. A drawing is pure
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
appear; drag a handle and only that point moves (a horizontal line has one
center handle that moves the whole thing). Esc cancels, Delete removes, and
`]` / `[` cycle the selection.

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
> The full story is under "Keyboard" in [plot-contract.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/plot-contract.md).

**Snapping** — `drawingTools({ plot, snap: true })` or `api.setSnap(on)`.
Drawing and endpoint dragging snap to bar values (close, low, high) and bar x,
but only within `snapRadius` (8px by default), and moving a whole drawing never
snaps (it keeps its relative layout). Off by default. The candidate values come
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
the debounce belongs on your side, the same as `move`. There's a working
example in the
[drawing tools case](../../apps/examples/src/cases/drawing.ts), which does a
localStorage round trip.

**Every drawing carries a stable `id`.** It's minted at the door (`add`, or
the moment hand-drawing completes) — you never invent one — and survives
save/load, so a side panel can key its own state by it. `handle.update(patch)`
edits a drawing in place (geometry, per-drawing `style`, fib `levels`); a key
passed as `undefined` returns that field to its default — `style: undefined`
goes back to the theme. Per-drawing `style` uses the same
`Partial<LineStyle>` leaves as the toolbox override (`width` · `color` ·
`dashArray`), and the values are literals: a drawing you colored by hand
keeps its color across a theme switch, deliberately.

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
