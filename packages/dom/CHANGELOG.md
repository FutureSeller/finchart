# @finchart/dom

## 0.1.0

### Minor Changes

- 8efb716: The wheel zooms by how far it moves: `zoomSpeed` per 100 px (one mouse notch), with line and page deltas converted to pixels and at most one notch per event, so a trackpad's stream of small deltas no longer slams the chart to its zoom limit. A mostly sideways wheel or trackpad swipe pans instead of zooming. The tooltip measures itself and flips to the other side of the cursor at the right and bottom edges of the pane it is over instead of overflowing them, even in a container larger than the chart. Pointer positions are measured from inside the container's border, where the canvas sits. Destroying the chart hands the container back without the `tabindex`, `touch-action` and `position` it added. The legend's default text colour is inherited from the page instead of a dark slate that vanished on dark themes. In React, unmounting `<XAxis>` or `<YAxis>` reverts what it applied, so a toggled-off axis format or a keyed pane swap no longer keeps the old format.
- 0e2c3ec: Bridge source and plotted x coordinates when loading transformed history, include DOM axis labels in browser PNG captures, and provide an opt-in accessible data table.
- 67868e7: The crosshair can be nowhere. The `crosshair` event fires once with `null` when the pointer leaves the chart, and `Plot.crosshair(null)` / `InteractionTarget.crosshair(null)` are the doors for it; the crosshair line and the tooltip clear on it, the legend goes back to the latest value, `<SyncX>` clears its siblings, and `<ChartContainer onCrosshair>` receives the `null`. A tooltip left holding the last value on a live chart read as the current price. The default pointer interactions clear on `pointerleave` and `pointercancel` — not during a drag, which goes on through the document.
- 37faf88: A pane divider handle is a keyboard control: a focusable `role="separator"` named "Resize panes" whose `aria-valuenow`/`aria-valuemin`/`aria-valuemax` give the upper pane's height and how far it can go, in whole pixels. `↑`/`↓` move it 8px (40px with Shift) and `Home`/`End` move it to its limit — a `DividerDragHandler` given `-Infinity`/`Infinity` moves the boundary as far as it goes; those keys stop at the handle, so neither drawing tools nor the container's pan and zoom keys see them, and a frame drawn while it has focus keeps the focus. Divider moves that arrive before the next frame now add up — keys or pointer moves used to start again from the last frame's heights, so the second of two quick moves replaced the first; a move now measures from the chart as it stands, without drawing a frame, and does nothing when no handle could be up (no data, resizing off, no room). No focus style is drawn — style `[data-chart-divider]:focus-visible`. `DividerBoundary` carries that `value: { now, min, max }`, from the same limits a drag is clamped to; a custom `DividerRenderer` receives it, and code that builds boundaries by hand must supply it. `<Legend>` inside a `<ChartPane>` shows that pane's series instead of always `mainPane`, and `<Tooltip>` takes `offset`, with a removed prop going back to 12. `cssReader` reads through the container's own window, so a chart in an iframe or popup takes that window's styles; a document with no window gives the empty reader.
- 8efb716: `tooltip()` and `legend()` read the bar under the cursor's pixel at every render, as the crosshair line does, so a keyboard pan, a live feed shifting the view or a linked chart moving it no longer leaves them showing a bar that is not under the pointer. **Type change**: both now ask their host for `XCoordinates` (`xAt`) — `Plot` provides it, but a hand-built host passed to either plugin must add `xAt(pixel)` or it no longer type-checks.
- 67868e7: The chart container is `touch-action: pan-y` instead of `none`: a vertical swipe over a chart that sits in a scrolling page scrolls the page, and the chart keeps horizontal gestures. What that gives up on touch is dragging the value axis vertically; a mouse is unaffected. `pointer.wheel: "modifier"` gates wheel zoom on Ctrl/⌘ — which is also what a trackpad pinch sends — so a plain wheel or two-finger scroll reaches the page; the default stays `"always"`.
- 6c119b6: A time axis sets the clock for the decorations too. `TickStrategy.format?` is the label a strategy gives a data x, and `timeTicks` offers it — date and time to the second, in its own zone and language — so `Plot.formatX` now resolves `axis.x.format`, then the strategy's `format`, then the rounded number: one `timeTicks({ timeZone })` and the axis, the crosshair badge and the tooltip header agree, with no second copy of the zone in `formatX`. A non-instant x — not finite, or past what a `Date` can hold — reads as the plain number instead of throwing out of a draw, and a year below 1 wears its era the way the axis years do. The strategy's hour formatters now say `hourCycle: "h23"` rather than `hour12: false` — the same clock on every engine, so a tick label at midnight reads `00:` where an older engine used to print `24:`. A series can describe its own tooltip rows: `Series.describe?(point)` returns `SeriesRow[]` (`{ label, value }`), a candle says O/H/L/C and V when the bar has a volume, and `probe()` carries them as `SeriesSample.rows`. The DOM tooltip and legend draw those rows after the name (`SOXL O 105.75 H 106.10 L 104.90 C 105.30 V 800`); a new `formatRow(value, { label, sample })` option formats such rows so a volume can read differently from a price, `formatValue` stays the scalar hook it was (and the fallback for rows), and a `null` row reads as a dash without reaching either. React's `<Tooltip>` and `<Legend>` take `formatRow` too.
  
  The standard decorations move without remounting. `priceLine(options)` returns a `PriceLineDecoration` with `setOptions(next)` (a whole new snapshot) and `applyOptions(patch)` (a merge into the current one); `markers(items)` returns a `MarkersDecoration` with `setItems(items)`. Both validate the candidate first and keep the old state when it is refused, and the line, its axis badge and the dots all read the one current state. React's `<PriceLine>` and `<Markers>` build their decoration once per pane and pass changed props in place, so a value that ticks every frame no longer removes and re-adds a registration.
  
  `fitDomains()` hands every pane back to `autoScale` after refitting — "show me everything" includes following it again — while the fit data changes take (the first data, an imperative `setData`) still leaves each pane's mode alone; to move x and keep a manual range, use `scrollToRealTime()` or `setVisibleRange()`. `Pane.resetValueAxis()` is the named form of `applyOptions({ autoScale: true })`, and a double-click on a pane's y-axis strip calls it (when `axisDrag` is on) — consumed by the axis, so neither the public `dblclick` nor `doubleClickReset`'s whole-chart fit sees it. A mode flip is a pane change: `panesChange` rings when a pane's `autoScale` turns back on, and `fitDomains()` rings at most once for the whole stack; a listener that throws mid-way does not stop the fit — it completes, and the error comes out at the end, one alone as itself, several as an `AggregateError`. A visible range set before the data (`setVisibleRange` before the first data) is dropped by the first fit when it does not touch the data's x range at all; an endpoint in common counts, and nothing extra is emitted.

### Patch Changes

- 1c50a4b: An x-axis label or crosshair badge centred on a tick at the data area's edge stays on the chart instead of hanging half off and being cut — it is kept between the data area's edge and the y-axis gutter on its side, on canvas through `within` and in the DOM through a CSS `clamp()` on its centring, so nothing is measured.
- c5f2014: `paneMaximize`'s Esc and double-click sit below the default input priority, so a drawing in progress or under the cursor answers first wherever the tools were installed — Esc cancels the line being drawn before it restores the panes, and double-clicking a drawn line selects it instead of maximizing its pane. Under `wheel: "modifier"`, a sideways trackpad swipe still pans — the setting decides when the wheel zooms, and a swipe left to the page became the browser's back gesture. And `bandSeries` describes its point as its upper and lower edge (`U`, `L`), so a band registered with a name reads as the range instead of its upper edge alone.
- 37faf88: `infiniteHistory` takes a series handle where it took a sink function, and stops by itself when that handle is disposed mid-fetch — no more `ContractError` thrown out of the landing on a symbol switch. `HistoryStatus` gains a final `"stopped"`: `dispose()` on an idle or loading loader, or a lost handle, reads `"stopped"`; disposing a loader that is already `done` or `terminated` keeps that reason. **Migration**: an exhaustive `switch` or `Record<HistoryStatus, …>` needs a `stopped` case. `statusChanges` now notifies on every change with the state as it is at delivery — a change made from inside another listener can be heard twice, never stale. A listener or sink that disposes the loader mid-flight leaves it stopped, and a rejection after dispose is still consumed. `lineSeries` and `areaSeries` take `{ coordinates, style? }` as well as a style — `lineSeries({ coordinates: new OHLCAccessor() })` draws candles by their close, so a candle ↔ line toggle is `swapSeries` between two factories; a style key beside `coordinates` is refused. Every package exports `./package.json`, so `require.resolve("<name>/package.json")` works. The READMEs state the Node floor the packages declare (`engines >=20.19`), which CI now runs.
- 8efb716: A divider handle moves only the two panes it was drawn between: `DividerBoundary.panes` names them, the chart refuses a move whose pair has changed since the last frame, and the DOM dividers end a drag when a different pair is drawn at the handle's slot — removing or inserting a pane mid-drag no longer resizes another pair.
- 443e0b1: A series registration takes `readout: false` for a series drawn for the eye rather than read out — a band fill, a marker row. The tooltip and legend leave it out; `probe` still returns it, marked `readout: false` on the sample (the field is present only then), so snapping and the crosshair magnet are unchanged. Like `name`, it is fixed at registration. **Behavior change**: the Bollinger, Keltner, Donchian and Ichimoku fills and the two Squeeze Momentum marker rows are registered with `readout: false`, so the tooltip no longer shows their unlabeled value rows. React `<ChartSeries>`, `<ChartLine>` and `<ChartCandles>` take `readout`. A pane divider whose limits meet — both panes at their floor — is marked `aria-disabled="true"` with the default cursor and starts no drag; it stays focusable and still keeps its arrow keys. `<ChartContainer containerRef>` holds the element the chart is built on, so a toolbar can hand focus back after a click (`containerRef.current?.focus()`), and the plot contract guide now shows that instead of claiming a React ref already did.
- f08059c: Keep requested historical x windows through live updates that do not move the view, and draw pane dividers only for the current frame's pane layout. OHLC aggregation now respects the visible point budget at clipped grid edges without changing the internal tier grid. Scales declare a required `kind`, so React panes can accept inline scale factories without replacing a same-kind axis on every render. Tooltips remeasure after a font change even when their text is unchanged.
- Updated dependencies [39e01fd]
- Updated dependencies [8efb716]
- Updated dependencies [8efb716]
- Updated dependencies [8efb716]
- Updated dependencies [443e0b1]
- Updated dependencies [70566ea]
- Updated dependencies [b5ebf0e]
- Updated dependencies [8efb716]
- Updated dependencies [0e2c3ec]
- Updated dependencies [67868e7]
- Updated dependencies [39e01fd]
- Updated dependencies [37faf88]
- Updated dependencies [1c50a4b]
- Updated dependencies [5789578]
- Updated dependencies [8efb716]
- Updated dependencies [c5f2014]
- Updated dependencies [dc47fd8]
- Updated dependencies [dc47fd8]
- Updated dependencies [37faf88]
- Updated dependencies [92957f7]
- Updated dependencies [37faf88]
- Updated dependencies [c449e77]
- Updated dependencies [8efb716]
- Updated dependencies [8efb716]
- Updated dependencies [664fd02]
- Updated dependencies [664fd02]
- Updated dependencies [8efb716]
- Updated dependencies [4e6d21c]
- Updated dependencies [dc47fd8]
- Updated dependencies [a9903d3]
- Updated dependencies [443e0b1]
- Updated dependencies [8efb716]
- Updated dependencies [dc47fd8]
- Updated dependencies [8efb716]
- Updated dependencies [f08059c]
- Updated dependencies [5e92e71]
- Updated dependencies [09be8ae]
- Updated dependencies [6c119b6]
  - @finchart/core@0.1.0
