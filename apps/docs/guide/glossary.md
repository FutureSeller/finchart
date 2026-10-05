---
description: "The vocabulary: plot, pane, series, decoration, plugin, scale, viewport, decimation, and how each differs from the one next to it."
---

# Glossary

Just the words this project uses, and what they mean. Every entry also says
**who owns it, what unit it is in, and where it lives in the code** — the
moment the same word starts meaning two things, coordinate bugs appear
quietly.

---

## Coordinates

### Domain

A value interval `[min, max]` expressed in **data units**. "January–March
2024", "price 120–180". Independent of screen size.

pan/zoom moves the x domain; the y domain is fitted to the value range the
series occupy.

```ts
scale.getDomain() // [120, 180]
```

### Range

An interval `[start, end]` expressed in **screen pixels**. Where the domain
actually gets drawn.

Reversed ranges (`start > end`) are allowed. Screen y grows downward, so a
value axis has to be set to `[bottom, top]` for larger values to sit higher.
**The scale holds that inversion** — that is how the chart and the axis see
the same coordinates.

```ts
yScale.setRange(area.bottom, area.top) // [460, 32]
```

> **Domain is data, range is pixels.** The one place in these docs where
> "range" means anything other than pixels is the `Range { min, max }` type
> (see *value range* below).

### Scale

A one-way mapping between domain and range. `scale(value)` is data → pixels,
`invert(px)` is pixels → data.

The domain keeps changing under pan/zoom, so it is a **mutable object**.
Implementations: `LinearScale`, `LogScale` (`scale/`).

### X mapping (`XMapping`)

**Where a data x lands on screen.** Everything series and decorations know
about x. The scale sits underneath doing domain↔pixels only; whether the
domain is time or bar index is the mapping's call. What a data x *means* on a
time axis — an instant, and which zone labels it — is
[Time zones and sessions](/guide/time-zones).

- `continuousX` — the default. The domain *is* x, so an empty interval is
  empty space on screen too.
- `barIndexX` — bar-index coordinates. A bar is one slot from its neighbor
  regardless of the x gap, so weekends and market closures never open up as
  blank space. Prepending history extends into **negative indices** — existing
  bars keep their index, so the window you were looking at stays put.

The domain is the mapping's own space, but **everything that goes out is x** —
events, crosshair, viewport, tick labels.

### Visible range (`getVisibleRange`)

The x window on screen, **in data x** — `{ min, max }`, or `null` before the
first fit. The reading side of `setVisibleRange`; changes are announced by
`xDomainChange`. The pane layout (order, `flex`, `minHeight`) and each
pane's value-axis mode (`autoScale`, `invert`, `yScale`, its range through
`yScale.getDomain()`) are read from `plot.panes`, and their changes are
announced by `panesChange`. The chart has no restore door for its view: a reload starts
from the data.

### Viewport

One value carrying both the **data interval the screen is looking at and the
canvas size**.

```ts
{ startX, endX, width, height }
```

`startX`/`endX` are **data x**; `width`/`height` are CSS pixels. The data
manager takes this and decides which interval to slice and how many points to
keep. It is x under bar-index coordinates too — Plot runs the domain (the
index) back through the mapping before handing it over. When the screen is a
different space from x, the coordinate decimation buckets by (`screenXOf`)
rides along with it.

### Plot area (`PlotArea`)

The actual drawing rectangle with padding taken off,
`{ left, right, top, bottom }`. Screen coordinates (px).

Built by `plotAreaOf(size, padding)` (`primitives/geometry.ts`).

### Slice

A horizontal cut of the plot area, one per pane. Each pane takes its slice
through `setArea` and updates **only the range** of its value axis (the domain
is left alone).

### Padding

The margin between the canvas edge and the plot area. Where axis labels sit.

### CSS pixels / device pixels

One CSS px is not one physical pixel. Retina paints 1 CSS px as 2×2 device
pixels. That multiplier is the **DPR** (`devicePixelRatio`).

**Every coordinate the code handles is in CSS pixels.** Device pixels show up
in exactly one place — `canvas.width`/`height` (the backing store) — and the
context transform carries the scale factor by itself.

---

## Data

### Data point

The smallest unit that has an `x` (`BaseDataPoint`). `x` is a `number` —
a timestamp in milliseconds, a bar index, anything you can order (ADR-0040).

| Type | Value field | Used by |
|---|---|---|
| `LineDataPoint` | `y` | line, area, baseline |
| `OHLC` | `open`/`high`/`low`/`close`(`volume?` — `null` is a gap; the four prices never are) | candles, OHLC bars |
| `HistogramPoint` | `y`(`tone?`, `color?`) | histogram (volume, MACD) |

`y` is `number | null` — `null` is *whitespace* (below).
`HistogramPoint.tone` is per-point because up-or-down is not styling but **a
fact about the data**, and the only side that knows that fact is the side
making the point. The tone picks a colour slot (`--chart-histogram-up` /
`-down`) and the theme fills it; `color` is an explicit literal for one bar,
outside the theme.

### Source data / visible data

- **Source data** is **the entire array one registration holds**
  (`addSeries({ data })` or `handle.setData`). It belongs to the registration,
  not to the chart, so it can differ per series — that is what lets BTC and
  ETH be drawn on one chart. **It must ascend in x** — slicing is a binary
  search. A plain registration's accessor checks that and raises a
  `DataError`; a derived registration checks its derive's output instead —
  of its source only `updateLast(point)` checks the point's shape and, once
  the source holds a point, that its x is finite and not earlier than the
  last one (that is how it tells a replace from an append) — so a source
  array is yours to keep in order (below).
- **Visible data** is what comes out after slicing by viewport and running
  decimation.

A derived series' `derive` receives the **source data**. It has to, or
indicators that look backward — a moving average — would break off at the left
edge of the screen. What the registration validates is the derive's
**output** — the points it draws — not that source: a source array handed to
`setData`, `append` or `prepend` is yours to check before you hand it over
(`updateLast` alone checks the one point's shape, and its x once there is a
last one to compare with), and the plot
contract's [price-axis transforms](/guide/plot-contract#price-axis-transforms)
says why that matters for a transform.

### Accessor (`CoordinateAccessor`)

How the layout numbers get pulled out of a point. `getX(point)`, `getY(point)`;
optionally `getYRange(point)` (the span a candle has, what a probe snaps to)
and `getPositiveFloor(point)` (the smallest positive value the point holds —
what a log axis stands on when the point dips to zero or below).

For the same `OHLC`, measuring the x range needs `x` while placing y needs
`close`. The extraction rule is kept separate from the point type
(`data/accessors.ts`).

### Decimation

**Thinning points out** when there are more of them than the screen is wide.
Stops the waste of stacking several points into one pixel.

| Strategy | How | |
|---|---|---|
| `M4Decimation` | four per pixel column — first, last, min, max | **default** |
| `OhlcAggregation` | merges candles instead of picking among them | `candleSeries()` brings it along |
| `LttbDecimation` | keeps points with the largest triangle area, preserving shape | |
| `SimpleDecimation` | skips at a fixed stride | |

**Strategies that keep one point per bucket (`SimpleDecimation`,
`LttbDecimation`) lose
the extremes**
— with an up-spike and a down-spike in the same bucket, one of them has to go.
That is why the default is `M4Decimation`.

### Aggregation

Where decimation **picks** some of the source points, aggregation **merges**
several into one. Candles are the side that needs this — pick one bar and the
highs and lows of the rest disappear, so five 1-minute bars fold into one
5-minute bar as `open=first, high=max, low=min, close=last`.

### Tier

Data prebuilt by halving, level after level. Panning while zoomed out then
scans one tier instead of the whole window. Turned on with the `tiered`
option, and **off by default** — it costs up to twice the memory and is thrown
away every time the data changes.

### Value range (`Range`)

A `{ min, max }` pair. Neither domain nor pixels — **just an interval**. The x
range (`getXRange`) and a series' value range (`valueExtent`) both use this
type.

### valueExtent

The interval a series **occupies on the y axis**. A line is a single point, so
`min === max`; a candle occupies `low`–`high`. One number cannot say that,
hence `Range`.

A pane's `valueExtent` is the **union** of the series it holds. **`null` when
there is nothing to measure** — return `{0,0}` there and a series whose data
has not arrived yet drags the value axis down to 0.

### Whitespace

`y: null`. **The slot is there and the value is not.**

Different from dropping the point outright — drop it and the x's close up, so
**the line strides across that interval.** An indicator's warmup (the first 19
of an MA(20)) and a bar only one series has are the same thing.

Three places know it together: the line breaks there, `valueExtent` does not
count it, and decimation does not swallow it.

**x cannot be empty.** A point you cannot place cannot even be drawn as a
hole, so a non-finite x is thrown as a `DataError` — or reported as
`non-finite-x` by `validateSeriesData` if you ask first.

### Computed node (`computation`) / source (`Source`)

A **source** is a one-method contract: `read(): DataView<T>`. The place where "where
the points come from" gets passed **as a value** — a series handle is a
source, and so is a branch of a computed node.

A **computed node** takes input sources and emits **several branches**. When
one calculation feeds several drawings — MACD — the calculation runs once. You
build it with the free function `computation({ inputs, calc })`, and it is not
registered on the chart.

**It pulls.** When you read a branch, if the identity of the input arrays is
unchanged it hands back the previous result — there is no subscription to
wire, and a branch nobody draws merely keeps its value ready.

`derive` remains as sugar for the one-input, one-output case.

### Fit

Refitting the domain to the data. `fitDomains()` (which also hands every pane back to `autoScale`), `fitValueDomain()`. `resetValueAxis()` only turns the mode back on — the fit itself happens on the next render.

**Only three things fit x** — the first data arrival, imperative
`handle.setData`, and `fitDomains()`. Incremental adds
(`handle.prepend`/`append`) do not fit, and neither does a declarative `data`
update: otherwise the view would zoom out the more history you loaded, and a
series mounted later would jerk your window out to the union. Data that
arrives after every series went empty counts as a first arrival again — a
value range set by hand on the old data goes with it — and a first fit to a
single x (a chart mounted empty and fed bar by bar), or to a history too
short to fill the screen at the default spacing, keeps fitting each data
change until the window is moved: it fills the screen until the bars would
be narrower than the default spacing (8px), then keeps that width and
follows the newest bar. A lone bar gets a window ten bars wide.

When a series draws a bar body (candles, OHLC bars, histograms — a series
says so with `barBody`), a fit shows the data plus **half a bar at each
end** (the gap to the neighbouring bar, halved; half an index under
bar-index x), so the first and last bodies are drawn whole. A chart of lines
alone fits edge to edge. `rightOffset` adds on top, and "the live edge" that
`scrollToRealTime` and `shiftVisibleRangeOnNewBar` return to is that padded
end.

---

## What gets drawn

### Series

Knows only **what shape to draw the data in**. Two required answers and four
optional ones, six in all.

```ts
valueExtent(data): Range   // how much y it occupies
draw(renderer, context)    // how it draws
decimation?                // how its points are thinned
coordinates?               // how their coordinates are read
describe?                  // what a tooltip says about one of its points
barBody?                   // whether a point is a body a bar wide (a fit keeps half a bar at each end)
```

The optional ones (`describe` is the series' alone — a registration does not
override it) are where "the side that knows the point type states the
policy" lives — a candle's value is its close, and only the candle knows that.
The two policies, `coordinates` and `decimation`, are resolved registration
first, then series, then fallback: a
registration's `coordinates` wins over the series', and plain `x` / `y` reads
when neither says; a registration's `decimation` fields win over the series'
field by field, and the wiring's policy fills what neither sets.

Grid, axes, pan/zoom, and layers belong to Plot, so a series knows nothing of
them. Six built-in implementations:
`LineSeries`·`CandleSeries`·`HistogramSeries`·`AreaSeries`·`BaselineSeries`·
`BarSeries` (`series/`).

### Derived series

A series that draws values computed from the source data. Indicators —
moving average, RSI.

```ts
pane.addSeries({ series, derive: (source) => points, coordinates })
```

The result is **cached against the source array's reference**. Without the
cache it recomputes on every render.

The point types of the source and of the derived result are **sealed inside
the registration.** The pane does not know those types and only calls what the
registration can do (`valueExtent`, `draw`). That is why `getSeries()` hands
back a `SeriesId` (= `unknown`) — all you do with it outside is `===`, so that
is all you get.

**That is why a pane has no point-type parameter.** BTC (OHLC) and ETH (line)
sit side by side in one pane. The only place a type is needed is where data
goes in and comes out, and that stays on the handle `addSeries` returned.

### Decoration

**Something drawn on the chart that is not a representation of data.**
Crosshair lines, the current-price line, span shading, watermarks, the grid.

One criterion separates it from `Series` — **it does not take part in
value-axis fitting.** Register a target-price line as a series and its
`valueExtent` pulls y along until the price goes flat.

```ts
pane.addDecoration(d, { zIndex })   // things that need y
plot.addDecoration(d, { zIndex })   // things that use the whole chart
```

Stacking order is settled by `zIndex` alone. Series draw at `SERIES_Z` (= 0)
and decorations slot in before or after — `BELOW_SERIES` (−1000, where the
grid goes) and `ABOVE_SERIES` (1000, **where you land if you omit it**) are
the two named slots. Within the same z it is registration order.

### Extension

**The umbrella term for everything mounted onto the chart** — it covers the
plugins you plug into `use()` (crosshair, tooltip, legend, syncX,
paneMaximize, drawing tools, indicators) and the decoration factories you plug
into `addDecoration` (priceLine, markers, span, watermark) — "extensions come
wrapped." All they consume is the capability interfaces and the plugin
contract.

Where it lives does not decide what it is — core built-in extensions sit in
`core/src/extensions/`, external ones in `@finchart/tools` and
`@finchart/indicators`, but they stand on the same contract. The only
difference is whether they ship by default. **The one thing that is not an
extension is what the chart installs itself** — by that test the chart owns
exactly one: the grid (`plot/grid.ts`).

Plugin, extension, and package are not competing categories but **three
different axes** — the same crosshair is a plugin (form), a built-in extension
(relationship), and shipped with core (distribution). A new extension's place
is settled by three questions.

| Word | Axis | The question | Opposite |
|---|---|---|---|
| plugin | form | how does it install and dispose | decoration factory |
| extension | relationship | is it a part of the chart, or mounted on it | a part of the chart |
| package | distribution | does it install alongside core | built into core |

The built-in/external test is **"will this feature keep gaining neighbors?"** —
a growing list (17+ indicators, 12+ drawings) goes in its own package; a
one-off that closes over the chart's own vocabulary (crosshair, current-price
line, sync) goes built in.

### Plugin

**Of the two forms an extension takes, the one with install and dispose.**
`Plugin<Host, Api>` is a **function** that takes a host and returns an API with
a dispose, and it plugs into `plot.use()`. Build it with
`pluginApi(api, dispose)` — merge with a spread and the `disposed` accessor
gets copied as a value and freezes at false forever.

The test that separates them: **anything with input, event subscriptions, or
something to dispose is a plugin** (crosshair, tooltip, legend, syncX,
paneMaximize, drawingTools, `attach*` indicators); **anything that only draws
is a decoration factory** (priceLine, markers, span, watermark — plug into
`addDecoration` and get a remove back).

A plugin asks for its host not as the whole `Plot` but as **the intersection
of the capabilities it needs** — `DecorationHost & RenderRequester`. Function
parameters are contravariant, so a plugin that asks for less takes a host that
gives more, as is.

### Pane

**A bundle of series sharing one value axis.** The unit that lets this library
treat overlaying and separate regions as the same concept.

- Put them in the same pane → **they overlay** (later one on top)
- Put them in different panes → **they draw in regions split top to bottom**

**Plot owns x, Pane owns y.** pan/zoom only touches x, so however many panes
there are, they move together on their own.

`plot.mainPane` is always there. Make no pane of your own and every series
lands in it.

### Plot

**The chart itself.** It owns the canvas, the layers, the x axis, interaction,
and the pane list; data and series get swapped in and out underneath. What you
mounted on it (the interval you are looking at, overlay DOM) survives the swap
→ [plot-contract.md](plot-contract.md)

### Axis

Reads a scale's domain and range and **computes the list of ticks**. It does
not draw.

Tick density **comes from pixels.** It picks from 1·2·5 × 10ⁿ so the spacing
stays readable (80px horizontally, 40px vertically). That is why a short pane
thins its ticks out on its own.

A scale with its own geometry is the exception: `LogScale` supplies tick
**placement** itself (`Scale.tickGeometry` — decades × 1·2·5 in log space),
because linear spacing crowds a log axis's top and leaves its bottom empty.
The label still belongs to whatever `format` is in force — geometry never
carries labels, so toggling to log keeps your formatter.

### Tick

`{ value, position, label }` — data value, pixel position, display string.
(`TickGeometry.values()` is the bare-number stage before this: placement
without labels, which the axis then combines with `format`.)

### Grid line (`GridLine`)

The guide line drawn at a tick's position. It comes out of **the same
computation** as the tick. Compute them separately and they drift apart
eventually.

### Divider

A DOM handle sitting between panes. Drag it to change heights. It is DOM
rather than canvas so the browser owns the cursor shape and the hit area, and
so the handle you are dragging does not vanish when the canvas redraws.

### xDomainChange

The event announcing that **the x interval you are looking at has changed.**
It fires on pan, zoom, and fit — and only when the value actually differs.

```ts
{ startX, endX, dataRange }
```

`dataRange` is the x range of the data the chart holds (the union across
series), so you can measure how close to the edge you are from the payload
alone. Incremental adds do not touch the domain, so they are silent — that is
why prepending history inside the handler does not recurse.

### Drawing history (`undo` · `redo`)

**The drawing tools' command stack** — one command per committed edit
(`add`, `remove`, `update`, a whole drag on release), replayed onto the
same objects so handles and selection survive. It is session state, not
part of `serialize()`, and `clear()` or a successful `load()` empties it.
Three things in this glossary share the word "history" and are unrelated:
this one (drawing edits), the *visible range* (the x window an app may
move back to with `setVisibleRange`), and *infinite history* below (loading
older bars).

### Infinite history (`infiniteHistory`)

**The past-loading door** — `infiniteHistory(plot, sink, fetch, { from })`
watches `xDomainChange` and asks your `fetch` for the page of points before
its cursor whenever the view nears (prefetch, on a leftward gesture) or
passes (gap fill, chaining until covered) the left edge of what is loaded.
You own the page before a given x and where a landed page goes — a series
handle (a loader notices a disposed handle at its next request or landing and
stops) or a function (no liveness to notice) — dispose the loader yourself on
teardown either way — plus the cursor's origin `from` (the first x you already hold; the
loader cannot guess it, since a chart-wide range is a union across series
and a derivation's own range is shorter than its source). An empty page
means the end of history (`done`); `terminated` is a fetch that broke its
contract; `stopped` is a loader that was disposed or lost its handle. For an
API that pages by a token instead of a time, cursor mode takes `{ from,
cursor }` and a fetch answering `{ bars, next }`: `next: null` is the end, and
a page with no older bar but a `next` moves the token and keeps going. The
loader's `cursor()` reads the token the next fetch would take — moved by an
empty page too, `null` once done and always in x mode — so a consumer can
start another loader later from the same place.

The loader defends its cursor: points at or after `before` are trimmed off
quietly (inclusive end bounds are the norm for exchange REST APIs — left
alone, the boundary bar would silently double), in x mode a non-empty page
trimmed to nothing throws instead of reading as the end, and an out-of-order
page terminates the loader. Its `status()` / `statusChanges` pair reports
`idle | loading | done | terminated | stopped`. Also answers to: infinite scroll,
load more, backfill.

### Conflation (`conflated`)

**The tick-burst door** — `conflated(handle)` folds the ticks that arrive
between two frames into one `updateLast` per frame, holding only the latest
state per bar (last-wins; bring a `merge` for partial-update feeds). Fifty
ticks a frame stop costing fifty full-array copies for a picture that only
shows the last one — measured, a 100k-point chart under 50 ticks/frame went
from 16.9 to 3.8 ms/frame. A bar boundary is never folded across: the old
bar's final state is delivered immediately. It is an opt-in wrapper around a
published handle, same standing as `syncX` — below ~10k points at modest
tick rates the win is noise, which is why it is a door and not a default.

### Crosshair

The event that reports the cursor position **translated into meaning.** It
does not hand over bare coordinates.

```ts
{ position, x, pane, value }
```

`x` is the same regardless of pane (there is only one x axis); `value` is read
through **the scale of the pane the cursor is over.** Over the padding, `pane`
and `value` are `null`.

---

## Layers and rendering

### Layers (`ChartLayers`)

Two layers stacked inside the container.

| Layer | What it is | What it holds |
|---|---|---|
| **Data canvas** | `<canvas>` | series, grid |
| **Overlay** | `<div>` | axis labels, dividers, annotations |

The overlay lets pointer events through by default. Redrawing the canvas
leaves the overlay DOM alive.

### Draw target (`DrawTarget`)

Three primitives — `drawLine`/`drawShape`/`drawText`. **Everything a series
knows about the renderer.**

Because it asks for this and not a concrete renderer, a series has no idea how
commands stack up or when they get replayed. The grid asks for just one of
them, `drawLine` (`GridTarget`).

The fourth slot, `drawCustom?`, is **optional and belongs to extensions** —
it is the door a third party puts its own primitives through, so the three
stay as they are and all new drawing goes here. Always call it through the
free function `drawCustom(target, draw)`: on a surface without that method,
optional chaining slides into **silently drawing nothing.**

### Renderer (`Renderer` / `CanvasRenderer`)

`DrawTarget` plus `clear()` and `commit()`. **Everything Plot knows.** It
deals in frame boundaries, so it stays invisible to series.

`CanvasRenderer` is the default implementation, and **it does not draw the
moment it is called.** Inspection windows like `getCommands()` belong to the
implementation, not to the contract.

### Command (`DrawCommand`)

The record of stacked-up draw calls — `drawLine`·`drawShape`·`drawText`·
`custom`, plus `clip`, which only the side handing out regions uses. At
`commit()` they replay onto the 2D context in order, after a `clearRect`.

A **tagged union** discriminated on `type`. The replay `switch` is
exhaustiveness-checked, so adding a command breaks the compile.

- `clear()` **throws away the stacked commands** — it does not clear the screen.
- The screen actually clears at `commit()`.

So partial state never reaches the screen, and you can test "what did it mean
to draw" without a 2D context.

### Scheduler (`RenderScheduler`)

Decides **when to draw.** Plot only announces "this needs redrawing" and knows
nothing of the timing.

Request again while one is already scheduled and nothing happens —
**coalescing is the scheduler's job**, so requests within the same frame become
one drawing.

| Implementation | When |
|---|---|
| `frameScheduler` | once on the next frame (the preset default) |
| `immediateScheduler` | the moment it is requested |
| `manualScheduler` | when a test calls `flush()` |

State still changes synchronously. The only thing deferred is painting the
canvas.

---

## Layout

| Term | Meaning |
|---|---|
| `flex` | A pane's height ratio. Relative, so the ratio survives a window resize |
| `minHeight` | The floor on a pane's height (px). Default 40 |
| `paneGap` | The gap between panes (px) |
| `valuePadding` | Headroom ratio above and below the value domain. Default 0.1 |

A pane that hits its floor is pinned and the rest re-divide what is left. If
the floors sum past the whole, everything shrinks proportionally
(`plot/layout.ts`).

---

## Interaction

| Term | Meaning |
|---|---|
| **pan** | Slides the x domain sideways. Drag right to see the earlier interval |
| **zoom** | Widens or narrows the x domain while holding one point fixed |
| `InteractionTarget` | The side that **applies** an interaction. Plot implements it |
| `InteractionHandler` | The side that **turns input into interaction intent.** `PointerInteractions` |

The pixel entry points (`panByPixels`, `zoomAtPixel`) live on Plot because
converting pixels↔domain needs the scale, and only Plot knows it. Let the
handler know the scale and the input layer takes on the coordinate system too.

---

## What gets thrown

**The dividing line is not "where did it come from" but "is there anything the
consumer can do".** Put the uncatchable in the same type as the catchable and
a `catch` meant to swallow a data error quietly swallows programmer bugs too.

| What | When | What the consumer can do |
|---|---|---|
| `DataError` | A **value** from outside broke the contract — x ordering, a non-finite x, a repeated x on bars, where a hole sits | **Catch it.** Server responses really do come back wrong at runtime — or ask `validateSeriesData` first |
| `ContractError` | The call site used the **API** against its contract — an undeletable pane, a non-positive zoom factor, a duplicate series id, a registration that does not own its data | Nothing. It is a bug; the code has to be fixed |
| `RenderError` | The **wiring** does not line up, so it cannot draw — DOM labels on headless layers, a canvas renderer on a surface with no context, a screenshot of a chart with no pixels | Nothing. The combination of collaborators has to be fixed |

The same renderer splits two ways: plugging it into a surface with no context
is **wiring**; asking it to draw a line from a single point is **a call.**

## The grammar of names

Public API names follow three rules — `attach` or no `attach`, a noun or
`create*`, a value or a function. From those alone you can infer what a name
returns and where it plugs in. The full rules and their exceptions are in
[reference/naming.md](/reference/naming).

## Easily-confused pairs

| A | B | What separates them |
|---|---|---|
| `DataError` | `ContractError` | the value is wrong / the way you called it is wrong |
| `gapless` | `uniqueX` | both are an accessor's static declaration; `gapless` skips the gap scan (falsely declared it swallows gaps quietly), `uniqueX` rejects a repeated x (declared it makes every door loud) |
| `ContractError` | `RenderError` | fix the call site / fix the wiring |
| domain | range | **data units / pixels** |
| the `Range` type | a scale's range | just an interval / an interval of screen pixels |
| viewport | plot area | the visible **data interval** (+ canvas size) / the **pixel rectangle** with padding taken off |
| Scale | Axis | **converting** value↔pixel, plus its own tick **placement** when its geometry differs (`tickGeometry` — log) / turning placement into **labeled** ticks |
| Series | Pane | one **representation** / a **bundle** sharing a value axis |
| Pane | Plot | owns y and the series / owns x, the canvas, interaction |
| `handle.setData` | `handle.append` | a new dataset (fits) / appending to the same dataset (does not fit) |
| handle (`SeriesHandle`) | `syncSeries` | owns the data / owns the list |
| `clear()` | `commit()` | discard the commands / clear the screen and replay |
| `scheduleRender()` | `render()` | schedule it / draw it now |
| `DrawTarget` | `Renderer` | what a series sees / what Plot sees |
| Series | Decoration | occupies the value axis / does not |
| Decoration | extension | one contract (drawing) / the umbrella term (plugins, decoration factories) |
| `data.width` | `canvas.width` | CSS pixels / device pixels |
| `flex` | `minHeight` | ratio / floor |

## Related

- [PRINCIPLES.md](https://github.com/FutureSeller/finchart/blob/main/PRINCIPLES.md) — the principles (referenced by name)
- [plot-contract.md](plot-contract.md) — which method touches what
- [Next.js and React apps](nextjs.md) — the client boundary, `deps` read once, StrictMode
- [Time zones and sessions](time-zones.md) — the axis's zone, epoch bars and calendar sessions
