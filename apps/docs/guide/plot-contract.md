---
description: "What every Plot method touches and what survives it — the table that says whether a call refits the domain, resets the viewport, or leaves your drawings alone."
---

# The Plot Contract: What Survives What

A `Plot` is the chart. The rendering (`Series`) and the data get swapped out,
but **what you mounted onto the chart survives the swap.** Two things are
mounted:

- **The range you're looking at** — the x domain (the pan/zoom position)
- **What you attached to the overlay** — DOM elements like annotations and tooltips

This document collects in one place what each public method touches.
When you add a new method, the default must be "touches nothing".

## What each method touches

| Method | Data | x domain | y domain | Layers | Render scheduled |
|---|---|---|---|---|---|
| `pane.addSeries({ series, data })` | that registration owns it | **fit, if it's the first data** | fit | — | once |
| `handle.setData(data)` | replaces that registration only | fit | fit | — | once |
| `handle.prepend(points)` | prepends | — | — | — | once |
| `handle.append(points)` | appends | — | — | — | once |
| `handle.updateLast(point)` | replaces the last point (same x) or appends (larger x) | —¹ | — | — | once |
| `handle.upsert(points)` | merges by x — replaces the bars it names, adds the ones it does not hold, keeps the rest | —¹ | — | — | once |
| `handle.dispose()` | removes that registration | — | fit | — | once |
| `pane.syncSeries(specs)` | replaced by each spec's `data` | — | fit | — | once |
| `mainPane.setSeries(reg)` | only that one registration remains | — | fit | — | once |
| `mainPane.clearSeries()` | drops everything | — | — | — | once |
| `pane.applyOptions(o)` | — | — | —² | — | once |
| `addPane(o)` / `removePane(p)` | — | — | — | redistributed | once |
| `addDecoration(d)` / its disposer | — | — | — | — | once |
| dragging a divider | — | — | — | redistributed | every move |
| `fitDomains()` | — | fit | fit, and every pane is `autoScale` again | — | once |
| `scrollToRealTime()` | — | shifts (width preserved, right edge = live) | — | — | once |
| `applyOptions(patch)` | — | — | — | — | once |
| `setViewport(size)` | — | — | — | resized | once |
| `pan` / `panByPixels` | — | shifts | — | — | once |
| `zoom` / `zoomAtPixel` | — | zooms in/out³ | — | — | once |
| `claimCursor(c)` / its disposer | — | — | — | cursor only⁴ | — |
| `requestRender()` | — | — | — | — | once |
| `render()` | — | — | — | — | **draws now** |
| `destroy()` | — | — | — | torn down | everything after is ignored |

`—` means it doesn't touch it. Read-only calls (`getOptions`, `getSeries`,
`handle.xRange`, `pane.xRange()`, `on`) touch nothing, so they aren't in the table.

¹ Two exceptions — if `shiftVisibleRangeOnNewBar` is on and **you were looking
at the last bar**, the window shifts right with the new bar the moment it
arrives (off by default); and the first data a chart gets is fitted,
whichever door it came through — unless a visible range was supplied before
the data arrived, which wins. Data arriving after every series went empty is
a first arrival again (a value range set by hand on the old data does not
carry over to it), and while the first fit covered a single x — or a history
too short to fill the screen at the default spacing — the window keeps
fitting each data change until something else moves it — filling the screen
until the bars reach the default spacing, then following the newest bar at
that width. When any series draws a bar body (candles, bars, histograms),
every fit pads each end by half a bar; lines alone fit edge to edge.

² Options **don't touch the points being drawn**, so the value axis isn't
refit on the spot (the branch where `PaneChange.data` is false). A pane with
`autoScale` on refits to the visible range on every render anyway, and on a
pane with it off, holding the range you set is the request. For the same reason
the x index isn't rebuilt either — in bar-index coordinates, changing one
padding value must not cost a merge sort over every point.

³ Zoom has limits (`min/maxBarSpacing`) — bar-index coordinates default to
min 0.5 and max 200 (px per bar), continuous coordinates have no default, and 0
turns the limit off in that direction. At a limit the point under the cursor
stays pinned and only the width is clipped, and when the width is clipped away
entirely the domain is **unchanged, so no `xDomainChange` goes out either**.
Turning the limits off doesn't buy you infinity — once the width reaches the
floor of floating point (the ulp of the domain values), zooming in stops
quietly. A fit or a window you set (`fitDomains`, `setVisibleRange`) doesn't
pass through these limits.

**Position has bounds too** — a gesture can't push the data off
screen. Pan travels only as far as `domain.min ≤ last bar` and
`domain.max ≥ first bar` (a screen width of padding is left on both sides), and
zoom's center is clamped to the data range — meaning you can keep zooming in on
empty space and never lose the chart.
From a window that points outside the bounds (one set with `setVisibleRange`
pointing into empty space), only the direction that moves back through passes.
With no data there are no bounds, and the programmatic path doesn't go through here either.

⁴ A claim on the cursor shape — nothing is drawn, so there's no render. **The
later claim wins**, and releasing it falls back to the one underneath. To change
the shape mid-drag, mount the new one first and release the old one after — that
way the on-screen cursor doesn't flicker in between. It doesn't throw on a
headless chart either — there's just no screen to show it on. The value is a CSS
`cursor` value as-is (`"grabbing"`, `"crosshair"`, `"ns-resize"`, …).

**There is no `plot.setData`.** Data belongs to the **registration**, not to the
chart — on a chart with three series there's no way to define where that call
would land. You hand it over at mount time (`addSeries({ series, data })`), and
to swap it later you use the `SeriesHandle` you got back then.

```ts
const btc = pane.addSeries({ series: candleSeries(), data: btcCandles });
const eth = pane.addSeries({ series: lineSeries(), data: ethPrices });

btc.append([tick]);        // only btc grows
eth.xRange;                // { min, max } | null — answers for itself only
```

## When it draws

**"Render scheduled" in the table doesn't mean it drew — it means it decided to
draw.** State changes the instant you call it; the canvas is drawn once on the next
frame.

```ts
handle.setData(data);
handle.xRange;         // already changed — state is synchronous
canvas.toDataURL();    // not drawn yet
```

Requests within the same frame **all coalesce into one.** Twelve pointermoves
during a pan, or the composition API mounting four series — one draw.

If you need it drawn now, call `render()` yourself. The scheduled frame is
dropped, so the same picture is never drawn twice.

```ts
handle.setData(data);
plot.render();         // draws now
canvas.toDataURL();    // it's drawn
```

To change the timing wholesale, pass `PlotDeps.createScheduler`. The preset
default is `frameScheduler()`, and where there's no `requestAnimationFrame`
(node, SSR) it falls back to running immediately.

| Scheduler | When |
|---|---|
| `frameScheduler(view?)` | once on the next frame (the preset default) |
| `immediateScheduler` | the instant it's requested — when you need the result on the line after the change |
| `manualScheduler()` | when a test calls `flush()` |

`destroy()` cancels the scheduled frame. No label ever gets drawn onto an
overlay that's already been torn down.

## Why it's built this way

- **Only three things refit x** — the first data arrival, the imperative
  `handle.setData`, and `fitDomains()` — plus the two cases that are a first
  arrival in disguise: data coming back after every series went empty, and
  a window still following a feed (a first fit to a single x or to a history
  too short to fill the screen), which refits on each data change until it
  is moved. Everything else keeps the range you were looking at.
  - The first one is needed because until then the x domain is the scale's
    default and nothing is in its place.
  - `handle.setData` refits because it's a **new dataset**. If `prepend`/`append`
    — which glue another page onto the same dataset — refit, the view would zoom
    out further with every page of history you load.
  - **The declarative lane (`syncSeries`'s `data`) doesn't refit.** Handing over
    an array again can't distinguish "replace" from "prepend", and a series
    mounted later must not jolt the window you're watching out to the union.
    That's why infinite scroll in React is, at bottom,
    `setState(prev => [...older, ...prev])` — `useInfiniteHistory` does that
    and also keeps the loader's place across a chart remount.
- **`setSeries` refits y only.** Every series occupies a different value range
  (line = close, candle = low–high). x is the range you were looking at, so it's kept.
  Data belongs to the registration, so **it isn't inherited from the previous one** — you hand it to the new registration.
- **`applyOptions` doesn't touch what you left out.** Pass `axis: { x }` and `y`
  stays as it was — the old `setConfig` was a shallow merge, so `y` vanished
  quietly right here. The unit of replacement differs by slot: `padding`,
  `axis.x` and `axis.y` merge per field; `style` is replaced wholesale (that's
  what lets `style: { grid: {} }` get you back to the defaults).
- **`applyOptions` doesn't rebuild the layers.** Recreating the `Plot` for
  something like a grid toggle would create a new canvas, and the pan position
  and the overlay annotations would go with it. A host (the React wrapper
  included) has to be able to change configuration without recreating the `Plot`.
- **Axis labels live in the overlay, not on the canvas.** The DOM elements
  survive a re-render (principle: split by surface).
- **`setViewport` changes state only.** The canvas bitmap follows right before
  the draw — assigning to `canvas.width` wipes the picture, so if the wipe and
  the draw drift apart you see a blank frame in between (resize flicker).
  The size itself lands immediately, so layout math on the next line already uses the new value.
- **The value axis follows the visible range** (`PaneOptions.autoScale`, true by
  default). Zoom in on x and the values in that range fill the pane.
- **While it's on, the value domain is derived, not state.** It's recomputed on
  every render, so anything you set by hand with `pane.yScale.setDomain()` is
  overwritten on the next frame. To set it yourself, turn it off with
  `autoScale: false` — then it fits once against the whole source data, as before.
  Two things hand it back: `pane.resetValueAxis()` (a double-click on that
  pane's y-axis strip does this, when `axisDrag` is on) and `fitDomains()`,
  which turns it on for every pane — "show me everything" includes following
  it again. The fit data changes take (the first data, an imperative `setData`)
  refits the range but leaves the mode alone. To move x while keeping a manual
  range, `scrollToRealTime()` or `setVisibleRange()`.
- **Nothing happens after `destroy()`.** Renders and state changes are ignored
  quietly — it doesn't throw because a late event handler calling in mid-unmount
  is the normal path.
- **The exception is a door that has something to hand back.** `addPane()` can't
  be ignored — ignoring it would mean **handing back a pane that pretends to be
  alive**. That pane isn't in `paneList` so nobody looks at it, yet `addSeries`
  works on it, and nobody ever calls `dispose` on the extensions installed on it.
  Instead of a quiet zombie it throws a `ContractError`. The dividing line is
  **whether there's something to hand back**: for a notification
  (`render`, `requestRender`, a state change) ignoring really does mean nothing
  happens, and for a door that makes something, it doesn't.

  ```ts
  const config = await fetchConfig();
  if (!disposed) plot.addPane(config.rsi);   // the late lander is the one that asks
  ```

## Pane

A bundle of series sharing one value axis. Put several series in the same pane
and they draw over each other, with the later one on top.

- **`Plot` owns x, `Pane` owns y.** pan/zoom only ever touches x, so however
  many panes there are they move together on their own.
- `plot.mainPane` is always there. If you never create a pane of your own every
  series lands here, so a single pane behaves exactly as it always has.
- `pane.valueExtent()` is the **union** over the series it holds. Each series
  occupies a different span (a line is one close, a candle is low–high), and only
  the union clips nothing. With no series there's nothing to fit against, so y isn't touched.
- **With nothing to measure it's `null`.** If a series whose data hasn't arrived
  reported `{0,0}`, the union would be dragged down to 0 and candles in the
  40k–70k range would be squashed against the edge of the screen.
- Pass the visible range (`Viewport`) and it measures that range only. Each
  registration clips through its own manager, so **a derived series measures the
  points it produced, not the source data**, clipped to the same viewport.
- `pane.xRange()` is the union of the x values the series it holds draw. `Plot`
  uses it when fitting x and when asking "is there anything to draw" — since the data
  moved down, the registration is the only thing that can answer that.
- Registrations **split three ways by where the points to draw come from.** A
  wrong combination is caught at compile time — not by a runtime check.

  | Kind | `series` | Data |
  |---|---|---|
  | as-is | `Series<TSource>` | `data` (its own) |
  | derived | `Series<TPoint>` | `data` + `derive` |
  | input | `Series<TPoint>` | `input` (someone else's) |

  ```ts
  pane.addSeries({ series: lineSeries(), data: candles });  // ✗ compile error
  pane.addSeries({ series: lineSeries(), input, data });    // ✗ compile error
  ```
- There are two ways to mount a series. `addSeries` is the imperative
  registration that **hands back a handle** (`dispose` is safe to call twice),
  and `syncSeries` **takes the whole list as an array.** Mix the two and
  the later call throws a `ContractError` before it detaches anything. To move
  from an imperative list to `syncSeries`, call `clearSeries()` first; to empty
  a declarative list and return to imperative control, call `syncSeries([])`.
  **The roles split: `syncSeries` owns the list, the handle owns the data.**
- **The six write doors on a detached handle** (`setData`, `prepend`, `append`,
  `updateLast`, `upsert`, `swapSeries`) throw a `ContractError`. Letting them pass quietly
  moved the chart for real — `setData`'s refit **re-fitted the x window against
  the remaining series** and the pan you had set jumped. Two doors detach a
  handle: a `dispose()` you called yourself, or imperative `setSeries()`
  replacing it. The latter is **a removal you never called**, so you ask with
  `handle.attached` — `read()`, `xRange` and `dispose()` are safe after
  detaching. Even an empty array (`append([])`) throws on a detached handle.

  ```ts
  socket.on("tick", (t) => { if (handle.attached) handle.updateLast(t); });
  ```
- Identity in `syncSeries(specs)` is `spec.id`. Same id keeps the registration
  and swaps only the series reference, so **the derive cache survives**, and
  `deriveKey` decides whether to recompute. **Draw order is array order** — a
  series that arrives late behind a condition still lands in its place. Build
  specs with `seriesSpec()`.
- A `Pane` holds neither a renderer nor data, so it can't redraw itself. When
  series or options change it **notifies its subscribers** (`pane.subscribe`) and
  `Plot` fits y and then draws. There can be several listeners, and each gets its own disposer.

### Computed nodes

**Run once, feed several drawings.** MACD isn't one line but three (macd,
signal, histogram), and hanging a `derive` on each branch runs the same EMA
three times.

```ts
const price = pane.addSeries({ series: candleSeries(), data: candles });

const macd = computation({
  inputs: [price],                       // values. you don't point at them by name
  calc: (candles) => ({ macd, signal, histogram }),
});

lower.addSeries({ series: lineSeries(), input: macd.out.signal });
lower.addSeries({ series: lineSeries(), input: macd.out.histogram });
```

- **A reference is a value.** A typo is a compile
  error, and **you can't reference something that doesn't exist, so a cycle is
  structurally impossible.** That's why there's no cycle check.
- **It isn't `plot.addComputation`.** Inputs and outputs are both values, so
  there's nothing to register on the chart — it's a free function and the `Plot`
  API doesn't grow by a single member.
- **It pulls.** When you read a branch, if the **identity** of the input array is
  unchanged it hands back the previous result. So however many branches there
  are, one data change means one computation, and there's no subscription to wire.
- Inputs are an **array** — some indicators read price and volume together, and
  widening from one to an array later would break every call site.
- An element can be a handle or **a branch of another computation**. Indicators
  on indicators come free.
- **Branch names are fixed by the first computation.** Even with empty inputs it
  has to produce the same keys.
- A registration that draws from `input` **doesn't own its data.** `setData`,
  `prepend` and `append` on that handle throw — what you swap is the input.

Measured: recomputing MACD's three branches every frame, **three `derive`s at
32.6ms → a computed node at 16.1ms (−50.8%)**; cold start 32.1ms → 17.7ms. A
paired comparison inside the same session.

### Whitespace

`y: null` is "there's no value here". **Keep the slot, empty only the value** —
drop the point instead and the line draws straight across that stretch, showing
a value that isn't there.

```ts
const ma = source.map((c, i) => ({ x: c.x, y: i < 19 ? null : average(i) }));
```

- The line is drawn separately **for each unbroken run of values** (it breaks at the holes)
- `valueExtent` doesn't count holes. All holes means `null`
- Decimation **doesn't swallow** holes — consecutive holes fold into one
- **x can't be empty.** A non-finite x is a `DataError` (the same type as an ordering violation)

### Checking data before it goes in

Every data door runs one rule set (`scanSeriesData`), and two doors let you
ask it **before** ingestion, as a value instead of a thrown `DataError`:
`validateSeriesData(data, accessor?, seam?)` for an array and
`validateSeriesPoint(point, accessor?, { lastX })` for one tick. `null` means
the matching door will not throw (identity registrations — a derived series
re-checks its own output under its own accessor). `lastX`/`firstX` are the x
you hold **as the accessor reads it** — `point.x` for every built-in one. Codes name the **fact the
data broke**, not the fix and not our declaration:

<!-- issue-codes:start -->

| Code | The fact |
|---|---|
| `not-an-array` | the payload is not an array (index −1) |
| `not-an-object` | a point is not an object |
| `unreadable-y` | the accessor reads no value from the first or last point — a wrong field name, which a `.map()` makes uniform |
| `non-finite-x` | x is not a finite number |
| `non-finite-value` | a value the accessor checks is not finite (for bars: a price is `null`/absent/`NaN`, or volume is present but not a number) |
| `unsorted-x` | x goes backwards — inside the chunk, or against the seam you passed |
| `duplicate-x` | x repeats where the accessor declared one point per x (`uniqueX` — bars do) |

<!-- issue-codes:end -->

| Door | Pre-check |
|---|---|
| `setData(data)` | `validateSeriesData(data, accessor)` |
| `append(points)` | `validateSeriesData(points, accessor, { lastX })` — `lastX` is the tail you hold; with `uniqueX` a chunk starting *on* it is a duplicate |
| `prepend(points)` | `validateSeriesData(points, accessor, { firstX })` |
| `updateLast(point)` | `validateSeriesPoint(point, accessor, { lastX })` — the same x replaces the bar, an earlier x is the past |
| `swapSeries(next)` | `validateSeriesData(handle.read(), next's accessor)` — a swap re-checks what you hold under the new rules |
| a derived series' own output | — ⁶ |

⁶ A derivation runs when its data changes — synchronously, inside the data
door that changed it (`setData`, `append`, `prepend`, `updateLast`) — and its
output is checked there, so a defect throws from that call; a registration
fed by an external `input` re-reads and validates that input when it is next
read. Validate the **source** you hand it.

The socket recipe (type-checked) is `onTick` in [Getting started's real
service](/guide/getting-started#real-time-updates-indicators). A page that
overlaps what you hold (an inclusive REST bound) is dropped with
`page.filter((bar) => bar.x > lastX)` — the filter `infiniteHistory` applies
to its own pages; a door that merges overlap for you is not here yet.

### Derived series

Sugar for one input and one output. If there's only one branch, use this instead of building a node.

```ts
pane.addSeries({ series, data, derive: (source) => points, coordinates });
```

- **`derive` gets that registration's whole `data`, not the visible range.** That's what it takes
  for an indicator that has to look backwards — a moving average — not to break off at the left edge.
  A series without `derive` gets the clipped range, as before.
- It recomputes **only when the data changes.** Calling it on the draw path
  would put the data size inside the frame budget — O(n) per indicator, so it
  multiplies as you add panes.
- The incremental doors — `calcLast`/`calcFirst`/`headLookback` on a computed
  node, `deriveLast`/`deriveFirst` on a derivation whose output is one point
  per input point — are optional and live on the node or registration that
  declares them. A plain `derive`
  has none: when `prepend` glues history on, the whole thing is recomputed, and
  that's what makes the values near the boundary correct on their own (a
  20-day moving average only becomes right once the 20 points before it
  exist). `deriveLast`'s contract is the shape of the changed tail — exactly
  one output point for a replaced last input, exactly `count` for `count`
  appended — so a derivation in which one input can create or destroy any
  number of outputs (a price-axis transform, below) has no honest way to
  declare it.
- The derived result is clipped against the same viewport and goes through
  decimation too. **Every registration, derived or not, has its own
  `DataManager`** — there's one path for clipping.
- **The managers come from one factory** (`PlotDeps.createDataManager`). Chart-wide
  policy — caps, tiers — is the same for all, and strategy and density are stated
  by **whoever knows the point type**:
  the registration (`decimation`) > `Series.decimation` > the factory default (`M4Decimation` at 4 points per pixel).
  They don't share an instance because each holds different data.
- `valueExtent` goes by the derived values too — it measures what the derive
  produced, not the source data. With `autoScale` on it clips those values
  **to the visible range again** before measuring. Don't confuse this with
  `derive` getting the whole source — compute over everything, measure over
  what's visible.

**A good share of the other "chart types" aren't new series — they're combinations of these ingredients:**

- **Scatter** — no new series type needed. Erase the line and keep the points:
  `lineSeries({ line: { color: "transparent" }, point: { radius: 3 } })`.
  Parabolic SAR in `@finchart/indicators` already plots points with exactly this trick.
- **Heikin-Ashi** — this is precisely where `derive` belongs. `heikinAshi(source):
  OHLC[]` (`@finchart/indicators`) is a pure function turning source OHLC into
  smoothed OHLC, so `candleSeries()` draws it unchanged:
  `pane.addSeries({ series: candleSeries(), data, derive: heikinAshi })`.
- **Renko** (and its lineage — Line Break, Kagi, Point & Figure) is a
  derivation too, but not a one-to-one one: a bar doesn't correspond to one
  input point, bricks are born and die as price moves, so x can't inherit the
  source's x. Its x is an ordinal, and that has consequences — the next section.

### Price-axis transforms

Renko throws time away and keeps price: a brick each time the close moves
`brickSize` in the current direction, and two bricks' worth — a one-brick
gap plus the brick — to reverse. `renko(candles, { brickSize })`
(`@finchart/indicators`) is a pure function `OHLC[] → RenkoBrick[]`, the
bricks are OHLC-shaped so `candleSeries()` draws them unchanged. Three rules
make it a price-axis transform — the rules of the lineage (Line Break ships
beside it; Kagi and Point & Figure belong to it too):

1. **x is an ordinal** (0, 1, 2 …), never the source's x. When one candle
   closes several bricks they share that candle's x as `closedAt` — the key
   that wins time back for the axis, the tooltip and the crosshair badge in
   one place, the axis format. Read the bricks from the handle — that is
   the array the chart accepted, atomically with its validation — and
   narrow the point, because `candleSeries()` types the handle's points as
   `OHLC`:
   ```ts
   const handle = pane.addSeries({
     series: candleSeries(),
     data: candles,
     derive: (c) => renko(c, { brickSize }),
   });
   plot.applyOptions({ axis: { x: { format: (x) => {
     // A tick inside the bricks' span takes the nearest brick's time; outside it there is no time — label nothing.
     const bricks = handle.read();
     const brick = x >= 0 && x <= bricks.length - 1 ? bricks[Math.round(x)] : undefined;
     return brick && "closedAt" in brick && typeof brick.closedAt === "number" ? label(brick.closedAt) : "";
   } } } });
   ```
   (Keeping the derive's return value in a variable of your own is one step
   behind on a rejected output: the chart keeps its last accepted bricks,
   your variable holds the rejected ones.)
2. **A transform is a `derive`, and the tick goes in through the source
   door.** Feed ticks with `handle.updateLast(candle)` / `handle.append([candle])`,
   and validate those candles yourself first: the registration checks the
   bricks it draws, not the candles it derives them from (footnote ⁶ above) —
   `updateLast` checks the one candle's shape and, once the source holds a
   candle, its x (finite, not earlier than the last); the array doors check
   nothing of the source — so a NaN close, or a duplicate x inside an
   appended array, passes through to the transform. On each
   tick the derivation re-runs, the x mapping follows (bricks may be born or
   die), and the x viewport is not reset: the visible range is not touched
   (an auto-scaled value axis still follows the visible values, as on every
   render), except that `shiftVisibleRangeOnNewBar`, when on and you were
   looking at the last brick, follows a new brick as it would a new bar;
   when the open candle's bricks die the range keeps its numbers and its
   right side goes empty; and the tick that produces the very first brick,
   if it is the plot's first drawn data, fits the domains once, as any first
   data does. `handle.setData(candles)` is for a new dataset (it is the source
   door too — the bricks are re-derived), not a tick: it requests a refit on
   every call (an output with no bricks has nothing to fit), and a chart
   that jumps to its full range twenty times a second is unusable. A noisy feed goes through `conflated()`.
   There is no incremental door — one candle can create or destroy any
   number of bricks, which is not the tail shape `deriveLast` promises — so
   every tick re-derives the whole output and revalidates it: O(input +
   output) per tick, a long tape is linear even when it yields few bricks.
3. **Ordinals are stable only over the closed prefix.** A tick can only
   create or destroy the bricks the still-open candle is producing; every
   brick before it keeps its value and its ordinal. A history page
   (`prepend`) re-derives from the new first candle and can renumber the
   whole output (whenever the page changes what the first brick is seeded
   from, or how many bricks precede the old head) — the drawing is right
   afterwards, but the window you were looking at may now show different
   bricks, so re-anchor it (`fitDomains()` or `scrollToRealTime()`).

**Options are the consumer's.** `brickSize` is required — knowledge of tick
size and volatility is not the transform's. A helper that suggests a step
from the data is something the consumer calls explicitly, so *when* the
suggestion was taken stays visible in the call site; the transform itself
never defaults it. `atrPriceStep` is that helper — take it once per symbol,
when the symbol loads, and catch the tapes it has no step for:

<<< ../snippets/renko-brick-size.ts{ts}

**What does not fit beside an ordinal axis — and what you would see.** The
core does not know an ordinal from a timestamp (x is a number either way),
so most of these are not refused; they draw wrong, and the table says what
wrong looks like:

| Beside a transform | What you would see |
|---|---|
| Time-x candles on the same pane | under `continuousX` the second series sits off-screen until a fit, and after `fitDomains()` the union of a timestamp range and an ordinal one squeezes the ordinal one into the left edge; under `barIndexX` the two become adjacent blocks of slots — the bricks first, then the candles, as if they followed each other in time. Either way snapping and the bar measure attach to whichever series was registered first |
| A volume pane fed by the time source | panes share one x mapping, so the pane's bars cannot align under the bricks — they land wherever their timestamps map (bricks carrying their own volume is not implemented yet) |
| `infiniteHistory` on the transform's handle (time-x candles as the source) | it installs, its cursor and its pages are in source space and correct — but it judges *when* to fetch in ordinal pixels, so with timestamps as the source x the first judgement already sees an infinite gap and it pulls pages without a cap until an empty one arrives |
| `handle.updateLast(brick)` — a tick on the transform's own points | wrong door: the handle's points are candles, so the brick is taken for one. Its ordinal x decides what happens next — below the last candle's x it is refused (`DataError: must keep x >= …`) and nothing changes; equal, it replaces the last candle; above, it is appended as a candle — and in the two accepted cases the bricks are re-derived from a tape that now holds a brick. Ticks go in as candles (rule 2) |
| Drawings and annotations | an anchor's x is an ordinal — valid only for one (transform, options, source) triple; the anchor's numbers stay put, but on the open candle's tail bricks the brick it points at can be replaced or vanish with a tick. An anchor's x is a number on that axis: a brick's ordinal when snapped, any value — between bricks, or in the empty space before the first or after the last — when placed free. To reload a drawing onto the **same** transform, options and source next session, take the nearest brick inside the span (`clamp(round(x), 0, bricks.length − 1)`), save that brick's `closedAt` **and its rank among the bricks that share it** (one candle can close several) plus the signed remainder `x − index`, and restore by finding that pair and adding the remainder back. Across a parameter change there is no faithful mapping — a rank can vanish, or survive pointing at another price — so treat a restore as best effort and handle a miss |
| The bar measure | counts bricks, and calls them bars |

**Reading a brick back from a probe.** `probe(x)` returns the value the
series' accessor reads (a brick's close, low and high), and `sample.index` is
the index into the derived array — the whole of it, not the decimated part
drawn on screen — so anything the brick carries beyond price is one lookup
away: `handle.read()[sample.index]`.

**Decimation.** When the core's OHLC aggregation merges points it builds the
merged candle from x, the four prices, `label` and `volume`; any other field
a derived point carries (`closedAt`, a tone) is gone from that bucket (below
the threshold the points pass through untouched). A series that draws such
points declares its own `decimation` strategy.

### Height

Space is split by `flex` ratio with `minHeight` as the floor. A pane that hits
the floor is pinned and the rest re-split what's left. If the floors sum past
the total, everything shrinks proportionally (`plot/layout.ts`). The gap between
panes is `PlotConfig.paneGap`.

`setArea` **changes the range only and never the domain.** The value range you
were looking at survives a height change, and with nothing to refit it's cheap.

### Axes

- **There is one x, shared by every pane.** The tick labels sit only under the bottom pane.
- **y is per pane.** `PlotConfig.axis.y` is the default and `PaneOptions.axis`
  overrides it per pane — see [one format per pane](#one-format-per-pane).
- Tick density comes from each pane's pixel height — a short pane thins out on its own.
  `Axis` reads the scale's range, so there's nothing to pass in.
- The grid is drawn per pane as well. A vertical line crossing the gap between
  panes would make two separate regions read as one.

#### One format per pane

A price, a volume and an oscillator are three different numbers, and a single
format prints at least two of them wrong: a won has no decimals, a volume is a
count, an RSI reads in whole numbers. Set the price format on the chart — it
is every pane's default — and give the panes that read something else their
own. A pane's format is used everywhere that pane prints a value: its axis,
its crosshair badge, its price lines, and the tooltip and legend rows it reads
out.

<<< ../snippets/pane-formats.ts{ts}

In React, a `<YAxis>` outside every `<ChartPane>` is the default and one inside
a pane is that pane's:

<<< ../snippets/pane-formats-react.tsx{tsx}

With no format anywhere, the axis prints values as they are and the badges,
tooltip and legend print two decimals — `293053.22` on a won chart — or the
tick step's digits when the step is finer than a cent, so a sub-cent price
never reads `0.00`. Two decimals stays the floor because changing it would
change every chart that never set a format; set one and the surfaces agree.

#### Writing a tick strategy

`axis.x.ticks` (or `axis.y.ticks`) takes a `TickStrategy`: one required method,
`ticks(context)`, returning `{ value, label }[]`, and an optional `format(value)`
— the label a decoration gives a data x in the strategy's own clock, which
the plot reads when no `axis.x.format` is given (`timeTicks` offers one). When a strategy is present it
owns placement, selection and labels together — the axis's own arithmetic and
`format` go unused, and **the frame draws what the strategy returns without
choosing among it.** `timeTicks` is the one shipped; a strategy of your own
gets the same context:

| Field | What it is |
| --- | --- |
| `min`, `max` | The visible domain, in scale space. |
| `span`, `minTickSpacing` | The pixels available, and the least a pair of ticks may stand apart. |
| `xOf(value)`, `domainOf(x)` | Domain ↔ data x. In a bar-index coordinate system the domain is the bar index, and these recover the bar's x and the index a boundary falls on. |
| `positionOf(value)` | Where a domain value is drawn, in pixels — the frame's own scale, so a strategy thins what will actually be drawn. |
| `snap(value)` | **Bar-index coordinates only.** The bar a boundary is drawn on: its own, or the first after it. Absent where the domain is continuous. |

Do the three steps in this order, because each needs the one before it:

1. **Candidates** — every boundary your rule offers inside `[min, max]`.
2. **Place and choose** — if `snap` is present, land each candidate on
   `snap(value)` and keep one per bar; then keep no pair closer than
   `minTickSpacing` by `positionOf`. Choose by what a boundary stands for, not
   by which came first: `timeTicks` places a year before a month, a month
   before a day, a day before a time of day, and the earlier among equals.
3. **Label** the survivors, in order. A label that depends on the tick before
   it — "Mar" on the first tick of a month — can only be decided once it is
   known which ticks survived.

A strategy that skips step 2 in bar-index coordinates draws a tick for every
boundary, including the weekend midnights that have no bar of their own; the
frame no longer snaps them for you. Step 2 can be omitted where the domain is
continuous and the boundaries already meet the requested pixel spacing; return
the candidates with their labels.

## Decorations

Things drawn on the chart that **aren't a rendering of the data.** One criterion
separates them from `Series` — **they don't take part in the value-axis fit.**
Register a target line as a series and `valueExtent` drags y toward it,
flattening the price.

```ts
const offLine = pane.addDecoration(priceLine({ value: 100 }));                        // above the series
const offMark = plot.addDecoration(watermark(), { zIndex: BELOW_SERIES }); // below
```

### Decoration or plugin — `addDecoration` or `use`

Try `plot.use(watermark())` and you're stopped. Here's the line:

- **A decoration is a single drawing description** — just `draw` (plus
  `axisBadges`), no wiring. Mount it with `addDecoration` and take it off with
  **the returned function** (when all you have to hand back is a disposer, hand back a function).
- **A plugin is a bundle of wiring** — the wrapper for when you install several
  things at once, decoration plus subscription plus DOM, and have to tear them
  down as one. Install it with `use` and take it off with **`api.dispose()`**.
- The names tell them apart: things that **draw**, like `watermark`, `priceLine`
  and `markers`, are decorations; things that **act**, like `crosshair`,
  `tooltip`, `legend` and `drawingTools`, are plugins. Put a decoration into
  `use` and the types stop you — the vocabularies aren't merged because
  [PRINCIPLES.md](https://github.com/finchart/finchart/blob/main/PRINCIPLES.md)
  principle 12, "extensions come wrapped", starts by separating the wrapper
  (plugin) from the ingredient (decoration).

### Install on the chart or on a pane — `plot.use` or `pane.use`

Plugins are divided by one more line of the same kind. The criterion is
**what it hangs from.**

| Extension | Where | Why |
|---|---|---|
| `crosshair`, `tooltip`, `legend` | `plot.use` | they cut across the whole chart |
| `attachMacd` | `plot.use` | it has to **create** a pane, so it needs `PaneHost` |
| `attachMovingAverage`, `attachBollingerBands` | `pane.use` | one `addSeries` is enough |
| `drawingTools` | `pane.use` | it draws on that pane |
| `paneMaximize` | `plot.use` | it toggles the chart's maximized pane and hit-tests every pane (`PaneHost`) |

**What you install on a pane dies with that pane.** `plot.removePane(rsi)` cleans
up the extensions attached to it — the old convention was passing a `pane?`
option by hand, and removing a pane left the extension none the wiser, still
holding onto a pane that had fallen away.

What a pane can't give — input, x coordinates, render requests — **arrives as
wiring**; `drawingTools({ plot })` is that shape (principle 11).

**Where it belongs decides its context.** `Plot` owns x and `Pane` owns y, so if
you need y you belong to a pane.

| Registered on | Area | What it gets |
|---|---|---|
| `pane.addDecoration` | that pane's slice | `pane`, `yScale`, `ticks.x`, `ticks.y` |
| `plot.addDecoration` | the whole plot area | `panes`, `ticks.x` |

Both get `data` (the visible range) and `readStyle`. The ticks arrive **already
computed** — computing them separately would put them out of step with the labels.

**Formatting arrives already resolved too** — the context's `formatX` (the chart's
`config.axis.x.format`) and `formatY` (that pane's y formatting, `pane.formatValue`).
The defaults for the crosshair badge, the tooltip, the legend and priceLine all
read these, so settle the axis format in one place and five surfaces are stamped
with the same ruler. A decoration's own option (`crosshair({format})` and the
like) remains as an override. Which x notation that is resolves in one order:
the consumer's `axis.x.format`, then what the tick strategy offers —
`timeTicks({ timeZone, locale })` labels a data x in its own zone and language,
to the second — then the rounded number. So one `ticks={timeTicks({ timeZone
})}` sets the clock for the axis, the crosshair badge and the tooltip header at
once; a `format` of your own still wins. Which zone to say, and why not the
runtime's, is in [Time zones and sessions](/guide/time-zones).

### Order = nesting

```
plot decorations with z < 0
  for each pane:
      pane decorations with z < 0   ← the grid is here (built in, BELOW_SERIES)
      series                        ← among themselves, by zIndex again
      pane decorations with z ≥ 0
plot decorations with z ≥ 0         ← the crosshair
```

"Plot-owned goes outside, pane-owned goes close to the data" isn't a rule to
memorize — it falls out of this nesting.

**One value divides them: `zIndex`.** The slot where series are drawn is
`SERIES_Z` (= 0), and a decoration's z slips in before or after it. Two named
constants mark the common spots.

| Constant | Value | Used for |
|---|---:|---|
| `BELOW_SERIES` | −1000 | below the data — grids, range shading, watermarks |
| `SERIES_Z` | 0 | where series are drawn (the reference point) |
| `ABOVE_SERIES` | 1000 | above the data — **the default for decorations** |

Within the same z it's **registration order**, and it inherits the same weakness
as `addSeries` — take one off and put it back behind a condition and it goes to
the back of that z. Series registrations take a `zIndex` too (0 by default), but
that's the order **among series** — it's the slot where a band fill toggled on
late gets laid under the candles. It's draw order and nothing more; the row
order in the probe and the tooltip stays registration order.

### Decorations that hold state

The crosshair's cursor position comes from input, not from the render. The
decoration holds it as its own state and calls `plot.requestRender()` when it
wants it on screen — unlike `render()`, requests within the same frame coalesce into one.

```ts
import { crosshair } from "@finchart/core";

const cursor = plot.use(crosshair());   // mounting + subscribing in one
cursor.dispose();                       // teardown in one too (plot.destroy() takes it off as well)
```

### Axis labels and dividers aren't decorations

They're DOM, their elements survive across frames, and they have a
`render/clear/destroy` lifecycle. They're injected separately through a
`PlotDeps` factory.

## Events

```ts
const off = plot.on("xDomainChange", (payload) => { ... });   // disposer
```

| Event | When | What it carries |
|---|---|---|
| `render` | after the picture actually went out | nothing |
| `xDomainChange` | when the x range you're looking at changed | `startX`, `endX`, `dataRange` |
| `crosshair` | when the cursor passes — **during a pan drag too**⁵ — and **once with `null` when it leaves** | `position`, `x`, `pane`, `value`, or `null` |
| `click` · `dblclick` · `contextmenu` | when you press on what's under the cursor | a `CrosshairPayload` — never `null` |
| `panesChange` | when the pane layout (a pane added, removed or reordered, `flex`, `minHeight`) or a pane's value-axis mode (`autoScale`, `invert`, the scale, a range set by hand) changed | nothing — read `plot.panes` |

⁵ The crosshair stays under the pointer during a pan too (since 2026-08-14) —
anything subscribing to `crosshair`, a tooltip for instance, keeps getting
updates mid-pan. **Exceptions**: touch pan (a crosshair under your finger tells
you nothing) and pinch stay quiet. A drag a tool consumed is the tool's: the
default pointer handler says nothing during it, and the tool may move the
crosshair itself (the drawing tools do while drafting).

**The three click events are the same echo as `crosshair`** — the payload is the
same shape (`CrosshairPayload`), so the *crosshair* section below applies
verbatim, except that a click is always somewhere: only `crosshair` can be
`null`. The plot says `null` once — a departure told twice, as a browser's
`pointercancel` then `pointerleave`, is one — and the default pointer
interactions say it when the pointer leaves the chart, or when a drag that
left is released outside. They arrive even if you never mounted a crosshair.

`xDomainChange` **doesn't wait for a frame.** The range you're looking at
changes synchronously, and so does the announcement.

- It fires on pan, zoom and fit. It fires **only when the value actually changed.**
- `handle.prepend`/`append` and declarative `data` updates don't touch the
  domain, so they're silent. That's why gluing history on from inside the handler
  doesn't recurse — infinite history loading hangs on this.
- `startX`/`endX` are **always the data's x.** Even in bar-index coordinates they
  aren't indices — they have to share units with `dataRange` for "am I near the
  end" to be measurable.
- The y domain isn't announced. It follows along with the series; it isn't a movement.
- `dataRange` is the x range of the data you hold. How close you are to the end
  is measurable from the payload alone.

Subscriptions guarantee three things.

- **Unsubscribing yourself inside a handler still calls every subscriber behind
  you.** One round runs over a copy of the list as it stood at that moment —
  effect cleanup is exactly this shape, and otherwise it gets swallowed quietly.
- **A subscription made during an emit joins from the next round.** Otherwise a
  handler could grow subscriptions without bound from inside itself.
- **Register the same function twice and you get two disposers**, each taking off one.

```ts
plot.on("xDomainChange", async ({ startX, dataRange }) => {
  if (!dataRange || startX - dataRange.min > THRESHOLD) return;
  handle.prepend(await fetchBefore(dataRange.min));   // setState if you're declarative
});
```

### panesChange — the pane layout or a value-axis mode moved

`panesChange` says *that* the panes changed; read what changed from
`plot.panes`. It covers the **layout** — a pane added, removed or reordered,
a pane's `flex` (a divider drag rewrites every pane's) or `minHeight` — and
each pane's **value-axis mode**: `autoScale`, `invert`, the scale
(`setYScale` with a different instance — a log toggle) and a value range set by hand (`setValueDomain`,
an axis drag). The x window has its own event (`xDomainChange`), and its own
reader:

```ts
plot.getVisibleRange();   // { min, max } in data x, or null before the first fit
plot.getDataRange();      // { min, max } of the data held, or null when empty
plot.on("panesChange", () => renderPaneList(plot.panes));
```

- It **doesn't ring** on a data change (append, prepend, a declarative update),
  on the x window, or for a fit to the data: a manual range that `setData`
  refits, that a scale swap can't hold and refits (the swap itself rings,
  once), or that `fitValueDomain()` fits moves without a ring of its own. Read
  `pane.yScale.getDomain()` when you need the range itself.
- `valuePadding` and `axis` don't ring: they shape how a pane draws, not where
  it sits or how its axis follows.
- It doesn't ring for a setting restated with its current value — React
  pushing the same props on every render, `setValueDomain` with the range
  the pane already holds, or `setYScale` with the scale already installed,
  stays quiet.
- `resetValueAxis()`, a y-axis double-click and `fitDomains()` ring when a
  pane's `autoScale` flips (not when it was already on). `fitDomains()` rings
  **at most once** for the whole stack, after every pane has flipped — a
  follower never sees a half-reset stack, and an x-only fit stays quiet. A
  listener that throws mid-way (`xDomainChange`, a pane subscriber,
  `panesChange` itself) does not stop the fit either: it completes, and the
  error comes out of `fitDomains()` at the end — one alone as itself, several
  as an `AggregateError`.
- A divider drag rewrites every pane's flex on every pointermove and rings
  once per move, not once per pane. Separate `pane.applyOptions` calls ring
  once each.
- A maximize rings once, a lone pane included. `plot.maximizePane(pane)` lets
  one pane fill the chart and lays the rest at their `minHeight`;
  `plot.maximizePane(null)` gives the split back; `plot.maximizedPane` reads
  it. It is a layout mode, not a rewrite — no pane's `flex` changes, so the
  user's split is still there underneath, a pane added meanwhile collapses
  and comes back at its own flex, and a flex set while maximized shows when
  the split does. It goes on its own when its pane is removed, and when a
  divider is dragged (the heights on screen become the panes' flex).

The chart keeps no restore door for its view. A window chosen before the data
arrives (`setVisibleRange` at mount, a date jump) lands in place of the first
fit **if it touches the data's x range** (an endpoint in common counts); one
that misses the data entirely is dropped and the first fit runs as usual.

A window set **with** data that starts before the data held — a jump to a date
not loaded yet — is placed by extrapolating the held spacing (the bar index has
no slot for an x it doesn't hold). The chart keeps the x you asked for and
re-places the window each time the data changes, so it lands on that date once
the history arrives. It lets go when you pan or zoom, when the window follows
a new bar, or once the window sits inside the data.

### crosshair

The `crosshair` event hands over meaning, not coordinates.

```ts
{ position, x, pane, value }
```

- `x` is a domain coordinate and **is the same regardless of pane** — there's only one x axis.
- `value` is read off **the scale of the pane the cursor is over.** Every pane
  has a different value axis, so without knowing which pane you're over there's
  no right number to produce.
- Over the padding or the gap between panes, `pane` and `value` are `null`. The
  check looks at both horizontal and vertical.
- `position` (screen coordinates) is still there.

### Dividers

DOM handles sit in the overlay between each pair of panes (turn them off with
`PlotConfig.resizablePanes`). They're DOM rather than canvas so the browser owns
the cursor shape and the hit area, and so redrawing the canvas doesn't make the
handle you're dragging disappear.

- The travel is **clamped by the `minHeight` on both sides.**
- The result is frozen by writing the current heights into `flex`, **scaled so
  the flex total stays near what it was** (by a power of two, which is exact,
  so the heights on screen come back to the pixel). `flex` is relative, so what remains is the
  ratio, the proportions you set follow along when the window resizes, and a
  pane added afterwards at the default `flex: 1` gets a share in the same units
  as the rest — not squeezed to its `minHeight` next to shares in the hundreds.
- **Every pane's flex is rewritten, including the ones you didn't touch.** A
  split pins some panes at their floor, so only the whole set, frozen together,
  reproduces the heights on screen.
- The value domain isn't touched — writing `pane.flex` directly bypasses the
  subscriber notification.
- The divider calls `stopPropagation()` on `pointerdown`. Without that the
  container's pan handler gets dragged along with it, no hit test involved
  (`pointer.ts` in @finchart/dom).

## Interaction — what works, and how to turn it off and on

The default interactions are wired by `browserDeps()` in `@finchart/dom`.
Fine-tuning goes through the `pointer` option — the recipe bundles the pieces,
so you never have to call a factory yourself:

```ts
const deps = browserDeps({ pointer: { kineticScroll: true, zoomSpeed: 1.2 } });
```

| Option | Default | Meaning |
|---|---|---|
| `pan` | `true` | drag to pan (touch included; listens on the document so it never loses the pointer); a mostly sideways wheel or trackpad swipe pans too |
| `zoom` | `true` | wheel zoom (x under the cursor pinned); two-finger pinch uses the ratio of x distances |
| `crosshair` | `true` | hover moves the crosshair |
| `doubleClickReset` | `true` | double-click resets to the full view (`fitDomains`, so every pane is `autoScale` again). On a y-axis strip (with `axisDrag` on) the double-click is the axis drag consumer's instead — that one pane's axis comes back, nothing else moves; that gesture stays even with `doubleClickReset: false` |
| `kineticScroll` | `false` | it coasts on release — off by default, it gets in the way of precise work |
| `keyboard` | `true` | toggles **only the floor gestures** (`←→` pan · `+/−` zoom) — see the section below |
| `zoomSpeed` | `1.1` | the factor per wheel notch — 100 px of wheel travel, so a trackpad zooms by the distance scrolled, not the number of events |

### Keyboard (accessibility)

**The container element** (the one you passed to `build()`) **always** takes
focus (`tabIndex 0`). Not the canvas — a `#chart canvas:focus-visible` selector
will never match. To take it out of the tab order, put `tabindex="-1"` on that
element yourself. **Don't erase the focus ring.**

**And keys only arrive while that element has focus — managing focus is the
caller's job.**

There's exactly one place this actually bites: **the moment you turn a tool on
from a toolbar button, focus goes to that button.** The Esc pressed right after
leaves the button and bubbles up into the toolbar without ever passing the
chart's listener — **every** key in the table below is dead. Turning a tool on
and then changing your mind with Esc is the most common cancel path, so
without this one line "Esc cancels" is true of the API and false in the hand.

```ts
const chartEl = document.getElementById("chart")!;
plotBuilder.build(chartEl);           // the key listener and tabIndex attach here

toolbarButton.addEventListener("click", () => {
  tools.begin("trend");
  chartEl.focus();                    // ← give back the focus it took
});
```

**There's no separate `plot.focus()`** because the caller already holds that
element — it's the one you passed to `build()`. In React, `usePlot` returns it
as `containerRef`, and `<ChartContainer>` hands it out through its own
`containerRef` prop:

```tsx
const chartEl = useRef<HTMLDivElement>(null);

<button onClick={() => { tools?.begin("trend"); chartEl.current?.focus(); }}>Trend</button>
<ChartContainer deps={deps} data={bars} containerRef={chartEl}>…</ChartContainer>
```

It isn't something the core can't do; it's **something the caller can already
do**, so it's written down here instead of carved into the core surface.

**With several charts side by side**, the element to give focus back to is *"the
one the chart you just operated passed to `build()`"* — not an outer wrapper such
as a cell or a card. Keys bubble upward only, so focusing the wrapper never
reaches the listener inside. `apps/showcase` carries this distinction around as
`keyboardHost`.

**And the name is the caller's job too.** The core makes that container a tab
stop (the core writes `tabIndex`), but gives it neither a name nor a role — the
core doesn't know **what** the chart draws. Leave it off and what a screen reader
user reaches is an unnamed container, and what gets read out is the string of
numbers the DOM overlay (axis labels, legend) exposes as-is. axe and Lighthouse
flag it as "focusable element without accessible name".

```html
<div id="chart" role="img" aria-label="AAPL daily, January–June 2024"></div>
```

Whether to hide the legend and tooltip with `aria-hidden` is the app's call —
those numbers may be the only text alternative there is.

**All `keyboard: false` turns off is the two "core" rows in the table below.**
`tabIndex` and the keydown listener attach regardless of the option, so even with
it off ⑴ the element still takes focus and ⑵ the keys headed for the input stack
(the drawing tools' `Esc`, `Delete`, `]`, `[`) stay alive. This option used to
close the door itself, so an app that turned it off because "I don't want `←→`
stealing page scroll" lost every drawing-edit key and couldn't even reach the
chart by keyboard.

| Key | What it does | Owner |
|---|---|---|
| `←` `→` | pan by 5% of the screen width | core |
| `+` `−` | zoom about the center | core |
| `Esc` | cancel the drawing → undo the drag → clear the selection (in that order) | drawing tools |
| `Esc` | (when the drawing tools have nothing to drop) restore the maximized pane | `paneMaximize` (default) |
| `Delete` `Backspace` | delete the selected drawing | drawing tools |
| `]` `[` | cycle the drawing selection (next/previous, wrapping at the ends) | drawing tools |
| double-click a pane | toggle maximizing that pane | `paneMaximize({ gestures: true })` — **opt-in**, off by default |
| `↑` `↓` (with Shift, 40px) | move a focused pane divider 8px | pane divider |
| `Home` `End` | move a focused pane divider to its limit | pane divider |

The divider rows are the exception to "the container takes the keys": each
handle between panes is a tab stop of its own (`[data-chart-divider]`), and
the keys it handles stop at the handle — neither the drawing tools nor the
`←→`/`+−` gestures see them. Every other key pressed on a handle bubbles to
the container as usual.

Ctrl/⌘+Z is not normalized into this stack yet. The DOM host keeps modifier
combinations for the browser, so an application that wants drawing history
binds the chart element and calls `tools.undo()` / `tools.redo()` directly.
That is a single-toolbox recipe; an application with toolboxes on several panes
must choose its active toolbox itself.

**The owner is whoever competes under the cursor.** Hang one set of drawing tools
per pane and `Delete`, `]` and `[` belong to **the pane the cursor last passed
over.** Over a spot where nobody competes (an axis, the padding, an indicator
pane with no toolbox) **the last owner stands** — going to the axis to read a
price label and then pressing Delete is a normal path. Only `Esc` doesn't ask
this question (it's the escape key: press it anywhere and whatever you were
doing ends).

**Right-click picks but doesn't eat** — on a line it selects that line, on empty
space it clears the selection (the same rule as the left button). And it returns
`false`, so the `contextmenu` event rings as usual. The app reads
`tools.selection()` inside it and builds a menu:

```ts
plot.on("contextmenu", ({ position }) => {
  const target = tools.selection();   // the drawing under the cursor, null if none
  openMenu(position, target);
});
```

**We don't block the native menu.** `@finchart/dom` calls `preventDefault` only
when a consumer **ate** the event, and the toolbox deliberately doesn't, so the
app has to block it with a `contextmenu` listener on its own container.
Otherwise the browser menu comes up on top of the app menu.

A key passes through the input stack once — if a consumer doesn't eat it
(`false`) it moves on, and since the drawing tools usually attach first, Esc
chains from there to `paneMaximize`. A key nobody ate goes to the core's
pan/zoom. Nobody takes Tab — moving focus belongs to the browser. To make a
selection programmatically, it's `tools.select(handle | null)`.

**Why the pane double-click toggle isn't the default**: `doubleClickReset` (true
by default, the table above) already spends a double-click anywhere on a pane as
a reset to the full view. `routeInput` is called before `fitDomains()`, so if
maximize ate dblclick by default that reset would die quietly on every pane
click — which is why you have to turn it on explicitly.

## The React composition API

```jsx
<ChartContainer deps={deps} data={candles} plotRef={ref}>
  <XAxis />
  <Crosshair />
  <ChartPane flex={3}>
    <YAxis />
    <ChartCandles />
    {showMa && (
      <ChartLine
        style={{ line: { color: "#f59e0b" }, point: { radius: 0 } }}
        derive={movingAverage(period)}
        deriveKey={[period]}
      />
    )}
  </ChartPane>
  <ChartPane flex={1}>
    <ChartLine derive={rsi(14)} deriveKey={[14]} />
  </ChartPane>
</ChartContainer>
```

The children render no DOM. **During the render phase** they claim a slot in the
collector of the pane they belong to, and after commit the collector hands the
whole list over with `pane.syncSeries()`. The core still knows nothing about the framework.

There are three series components. `<ChartCandles>` and `<ChartLine>` build the
core series for you, and `<ChartSeries series={...}>` is the escape hatch for a
`Series` you built yourself.

| What to use | When |
|---|---|
| `<ChartCandles style>` | OHLC as candles — `style` is `candleSeries(style)`'s `{ up, down, wickWidth, bodyRatio }` |
| `<ChartLine style coordinates derive deriveKey input>` | points as a line, indicators included — `style` is `lineSeries(style)`'s `{ line: { color, width, dashArray }, point: { radius, color } }` |
| `<ChartSeries series={...}>` | when you wrote the drawing yourself |

Things that aren't series have components too. **The built-in ones mount in two
different ways** — a plugin gets only its options swapped, while a decoration is
taken off and put back when its reference changes. `<PriceLine>` and `<Markers>` are the
exception: each is built once per pane and handed its new props in place, so a
value that ticks every frame moves the line, not the registration.

| What to use | What it is |
|---|---|
| `<Crosshair vertical horizontal style badges format>` | the crosshair (plugin) |
| `<Tooltip formatX formatValue formatRow offset>` · `<Legend formatValue formatRow>` | cursor value boxes (plugins) — a `<Legend>` inside a `<ChartPane>` reads that pane |
| `<PriceLine>` · `<Markers items>` · `<Watermark>` · `<Span>` | the standard decorations |
| `<ChartData value>` | the data the series below it will see |
| `<Plugin install deps onApi>` | any plugin of your own choosing — installed on the pane it sits in, reinstalled when `deps` change, its api handed to `onApi` after commit and `null` before it's disposed |
| `<InfiniteHistory history>` | pages older data into a `useInfiniteHistory` — see [Infinite history](/examples/infinite-history) |

- **Color goes in as an argument, not as a CSS variable.** A variable like
  `--chart-line` is the default for the whole chart, so it can't paint two lines
  in one pane differently — the canvas has no element to grab a series by. "This
  indicator is orange" goes in through `color`.
- **`<Crosshair>` is a decoration, not a series.** It doesn't take part in the
  value axis, so inside a pane or outside is the same, and it cuts across both
  panes. It's separate from `<ChartContainer onCrosshair>`, so **you can take the
  crosshair off and still receive cursor values.**
- **The first `<ChartPane>` reuses `mainPane`.** A `Plot` always has a mainPane,
  so making a new one would leave an empty pane taking up space at the top.
- **A pane's value axis is props.** `valueDomain={[0, 100]}` pins a range (an
  oscillator's) and wins over `autoScale` while it's set; once removed, the
  pane does what `autoScale` says. `yScale` is a factory called on updates;
  only a change in its scale's declared `kind` installs it in place, keeping
  the pane, its series and its height. Inline factories are fine.
- A series left outside any `<ChartPane>` goes to `mainPane`.
- `<YAxis>` inside a pane configures that pane; outside, it's the default for
  every pane. `<XAxis>` is shared, so you place exactly one.
- **Identity is the component instance.** The `id` the core demands is made by
  `<ChartSeries>` with `useId` and passed along, so it never appears on your side.
  Stay in the same slot and you're the same series; when you draw a list, React's
  `key` is what moves the slot.
- **You don't have to hold a stable reference.** Build `series` fresh on every
  render and the derive cache survives as long as the slot is the same. `useMemo`
  is optional now.
- **If there's a `derive`, `deriveKey` is required too** (caught at compile time).
  Same rule as `useMemo`'s dependency array — if the value is unchanged the
  derive isn't run again.
- **Draw order is JSX order.** An indicator toggled off and on behind a condition
  comes back to its place. But only the render phase knows the order, so **when a
  child mounts on its own without the pane rendering** (a component wedged in
  between changed its own state), that series is appended at the end. It finds
  its place on the next pane render.
- **The `data` prop flows straight through to the series.** The container sends it
  down through context and `<ChartSeries>` puts it in its own spec — the chart has
  no slot to receive data. So gluing history on is
  `setState(prev => [...older, ...prev])` — or `useInfiniteHistory` with
  `<InfiniteHistory>`, which does that and keeps the loader's place — and since
  the declarative lane doesn't refit, the range you were looking at stays put.
- **With several sources, each series names its own.** The container's `data` is
  the default for the whole chart, and two things override it — the `data` prop
  for a single series, `<ChartData value>` when several look at the same thing.

  ```tsx
  <ChartContainer deps={deps} data={btc}>
    <ChartCandles />                 {/* the container's data */}
    <ChartLine data={eth} />         {/* its own */}
    <ChartData value={eth}>
      <ChartLine derive={ma(20)} deriveKey={[20]} />   {/* everything below is eth */}
    </ChartData>
  </ChartContainer>
  ```

  **The first fit goes to whichever series arrived first** — each series mounts
  onto the chart from its own effect. To get everything in view, call `fitDomains()`.
- **The effect is what attests to identity.** The render phase settles only the
  slot (JSX order); admission to the list happens after commit — **a render
  doesn't guarantee a commit.** A series inside `<Activity mode="hidden">`
  renders but never mounts onto the chart.
- If you need the imperative API (`fitDomains`, `pan`), take it through `plotRef`.
- **The whole mount coalesces into one frame.** Every child's effect runs
  separately and requests a render, but there's one draw. The cost is that the
  first draw is one frame late, so a test that reads the canvas right after mount
  calls `plotRef.current.render()`.

## When you add a new method

1. Is there a clear reason to change the domain? If not, don't touch it.
2. Refitting the view is the caller's explicit act, through `fitDomains()`.
3. Don't call the render yourself — schedule it with `scheduleRender()`. However
   many steps you take, they coalesce into one frame.
4. Add a row to this table.

## Related

- Principles: state is synchronous and drawing is per-frame, interactions are
  automatic, split by surface —
  [PRINCIPLES.md](https://github.com/finchart/finchart/blob/main/PRINCIPLES.md)
- [glossary.md](glossary.md) — what the terms mean
