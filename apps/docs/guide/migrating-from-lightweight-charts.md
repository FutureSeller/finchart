---
description: "A side-by-side table from lightweight-charts to @finchart — creating, series and data, axes and the view, decorations, what only exists here, and where you will stumble."
---

# Migrating from lightweight-charts

Same job, side by side. The vocabulary differs for one reason: lightweight-charts
is a finished chart, @finchart is an **engine whose assembly is open** — the
collaborators are injected. So the very first line is different: you choose a
wiring, not an options object.

## Creating and destroying

| lightweight-charts | @finchart |
|---|---|
| `createChart(container, options)` | `PlotBuilder.create(browserDeps()).build(container)` — both from `@finchart/dom` |
| `chart.applyOptions({...})` | `plot.applyOptions({...})` |
| theme — `applyOptions({ layout: {...} })`, series color options (`upColor`…) | CSS variables `--chart-*` ([Theming](/guide/theme)); a single registration takes `options` overrides, and where there is no CSS, inject `deps.createStyleReader` |
| `chart.resize(w, h)` | `plot.setViewport({ width, height })` — or `browserDeps({ autoSize: true })` to track the container |
| `chart.remove()` | `plot.destroy()` |

## Series and data

| lightweight-charts | @finchart |
|---|---|
| `chart.addSeries(CandlestickSeries)` (v5) | `plot.mainPane.addSeries({ series: candleSeries(), data, name: "Price" })` |
| `series.setData(data)` | `handle.setData(data)` — every registration has its own handle |
| `series.update(bar)` | `handle.updateLast(bar)` — the same x replaces, a larger x is a new bar; a loud feed goes through `conflated(handle)` ([live feeds](/guide/live-feed)) |
| loading older data (calling `setData` again) | `handle.prepend(bars)` — the window you were looking at stays |
| `chart.removeSeries(series)` | `handle.dispose()` |
| whitespace data `{ time }` | for line, area and histogram data, `{ x, y: null }` — a gap the line does not bridge. The built-in OHLC series have no whitespace record: a bar is four numbers or it is not there, so leave it out |
| `time` (seconds, a string, a `BusinessDay`) | **`x` is just a number** — epoch ms or an index; the axis does the formatting. The type is `number`, so anything else is a compile error |

Convert `Date` objects and date strings to numbers **once, at your boundary**;
nothing converts after the data is in:

```ts
// Date objects
const candles = rows.map((row) => ({ ...row, x: row.time.getTime() }));
// lightweight-charts' time in seconds
const candles = rows.map(({ time, ...row }) => ({ ...row, x: time * 1000 }));
// Date strings: say the zone. new Date("2026-08-16") is UTC midnight and
// "2026/08/16" is local midnight — a JavaScript trap, not a data format.
const candles = rows.map((row) => ({ ...row, x: Date.parse(`${row.day}T00:00:00Z`) }));
```

## Axes and the view

| lightweight-charts | @finchart |
|---|---|
| `chart.timeScale().fitContent()` | `plot.fitDomains()` — refits x and every pane, and every pane follows the data again (`autoScale`) |
| `timeScale().setVisibleRange({ from, to })` | `plot.setVisibleRange(fromX, toX)` |
| `timeScale().scrollToRealTime()` | `plot.scrollToRealTime()` — keeps the zoom; automatic following is `applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset })` |
| `timeScale().scrollToPosition(pos, animated)` | no exact counterpart — `scrollToRealTime()` (to the end, width kept) or `setVisibleRange(fromX, toX)` to place the window yourself; animation is yours |
| `timeScale().applyOptions({ barSpacing })` | no absolute setter — `zoom(factor, center)` (`center` in the x mapping's own units) or `zoomAtPixel(factor, screenX)`; `minBarSpacing` / `maxBarSpacing` are **limits**, not a value |
| `subscribeVisibleLogicalRangeChange(cb)` | `plot.on("xDomainChange", cb)` — a **data x** range, never logical indices (under `barIndexX` too) |
| `chart.priceScale("right").applyOptions({ mode: PriceScaleMode.Logarithmic })` | `pane.setYScale(new LogScale())` |
| `chart.priceScale("right").applyOptions({ autoScale })` | `pane.applyOptions({ autoScale })` — back on again with that pane's `resetValueAxis()` or a double-click on its y axis; `fitDomains()` does it for every pane |
| `chart.priceScale('right').applyOptions({ scaleMargins })` | `pane.applyOptions({ valuePadding })` — a **ratio** added to the data range (default 0.1; on a linear scale at both ends, on a log scale in log space), not a share of the screen height, so the numbers do not carry over |
| `localization.priceFormatter` | `plot.applyOptions({ axis: { y: { format: priceFormat({...}) } } })` — not just the ticks: the crosshair badge, tooltip, legend and price lines read it too |
| `localization.timeFormatter`, `tickMarkFormatter` | three cases. With the default axis, `axis.x.format` formats ticks and decorations alike. With a tick strategy such as `timeTicks`, the **strategy** owns the tick labels and `axis.x.format` reaches only the decorations (crosshair badge, tooltip header). The strategy also formats decorations when you give no `axis.x.format`, so one `timeTicks({ timeZone, locale })` puts the axis, the badge and the tooltip on one clock ([time zones](/guide/time-zones)) |
| the `timeScale` tick options | `plot.applyOptions({ axis: { x: { ticks: timeTicks({ timeZone, locale }) } } })` — placement and wording come as one strategy |
| weekend gaps removed (the default) | `browserDeps({ createXMapping: barIndexX })` — bar-index coordinates |
| `fixLeftEdge` / `fixRightEdge` | no option needed — a pan gesture cannot push the data off screen. Forbidding the margin itself is not supported |

## Decorations and interaction

| lightweight-charts | @finchart |
|---|---|
| `series.createPriceLine({...})` | `const line = priceLine({ value }); const remove = pane.addDecoration(line)` — keep `line`: it moves in place (`line.setOptions`, `line.applyOptions`, then `plot.requestRender()`); `addDecoration` hands back the remover |
| `createSeriesMarkers(series, [...])` (v5) | `const dots = markers([...]); pane.addDecoration(dots)` — `dots.setItems(items)` re-sets the list, then `plot.requestRender()` |
| `watermark` option (a plugin in v5) | `plot.addDecoration(watermark({ text }))` |
| `chart.subscribeCrosshairMove(cb)` | `plot.on("crosshair", cb)` — drawing it is `plot.use(crosshair())`, separately |
| `chart.subscribeClick(cb)` | `plot.on("click", cb)` |
| crosshair magnet mode | `plot.use(crosshair({ magnet: true }))` |
| tooltip (hand-assembled DOM) | `plot.use(tooltip({ formatValue, formatRow }))` |
| legend (hand-assembled DOM) | `plot.use(legend())` |
| splitting panes (v5 `addPane`) | `plot.addPane({ flex })` — a value scale per pane |
| syncing two charts' time axes (hand wiring) | `syncX(plotA, plotB)` — propagates the **data x** window, so two `barIndexX` charts on different intervals do not end up with the same bar width; `syncCrosshair(...)` carries the cursor's x only (a vertical time ghost and an x badge), y stays each chart's own |

## What you can only do here

These are contracts the engine ships with; in lightweight-charts the same
ends are your application's to build on top of its API, or are out of reach.

- **Test the chart.** `createPlotModel({ size, series })` → assert on
  `model.commands()` — "was this value drawn at this pixel", in CI, with no
  browser and no screenshot.
- **The view state is a value.** `plot.getState()` goes into a URL or a store as
  JSON and `applyState` brings it back — reload and the window you were looking
  at returns. Key it by symbol and interval ([plot contract](/guide/plot-contract)).
- **You own the render tick.** `createPlotDeps({ createScheduler: manualScheduler() })`
  — drive frames yourself from a game loop or when composing with another canvas.
- **Indicators are computation nodes.** `movingAverage(price, { period: 20 })` is a
  node whose branch `.out.ma` is a `Source` again, so indicators stack on
  indicators ([custom indicators](/guide/extensions)).
- **You can take input.** `plot.addInputConsumer(consumer, { priority })` — the
  drawing tools take the drag of their own shapes away from pan entirely.

## Comparing symbols — side by side, not overlaid

In lightweight-charts, comparison means adding a series to the one chart and
switching `priceScale.mode` to `Percentage` (or `IndexedTo100`). **There is no
such mode here.** Instead, mount one chart per symbol and tie x and the cursor
together.

```ts
// One chart per symbol. Each has its own value axis, so the cheaper one is not flattened.
const unsyncX = syncX(aapl, msft, nvda);
const unsyncCursor = syncCrosshair(aapl, msft, nvda);
```

In React it is `<SyncX plots={[primary, ...comparisons]} />` and
`<SyncCrosshair plots={...} />` — rewired even when the list **changes length**.

| lightweight-charts | @finchart |
|---|---|
| add a comparison symbol + `mode: Percentage` | several charts + `syncX` · `syncCrosshair` |
| `priceScale.mode: Percentage` | none — feed the data as percentages and the axis draws them as they are |
| `leftPriceScale` and `rightPriceScale` at once | none — one value axis per pane (`position` **chooses** left or right) |

**Why this answer.** Put two price levels on one axis and the cheaper one is
pressed into the floor; the industry's fixes are percent normalization and two
value axes. Split the charts and **the problem never arises** — each chart has
its own axis, and only x and the cursor are tied. Pan, zoom and hover move as
one, so reading is the same as overlaid, and every value axis is honest.

What **only works overlaid** — the crossing point of two lines, a spread at a
glance — is not answered by this. It is open until someone actually needs it.

## Where you will stumble

- **It is not a finished product with one option for everything.** The
  crosshair, tooltip and legend are plugins you add with `use` — leave them out
  and they are not there.
- Decorations (`addDecoration` + the returned function) and plugins (`use` +
  `dispose`) have different vocabularies — the [plot contract](/guide/plot-contract)
  has "decoration or plugin".
- There is no `time` conversion utility — x is one number, so there is nothing
  to convert, but if you were on structures like `BusinessDay` you press them
  to epoch ms yourself.
