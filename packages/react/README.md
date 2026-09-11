# @finchart/react

React components for `@finchart/core`.

## Install

```sh
pnpm add @finchart/react @finchart/core @finchart/dom react react-dom
```
`@finchart/core` and `@finchart/dom` are peers — install them together. The
60-second example below imports from both directly, so **your app depends on
them directly** too.

**It is a client module.** The bundle carries `"use client"`: the package
creates a React context at module scope, which only a client module may do,
and the directive marks the boundary, so importing it from a server file
(Next.js App Router's default) no longer fails at the module. A chart still
needs a Client Component of your own around it: `deps={browserDeps()}` is a
function, and this function cannot cross the server–client boundary as a prop —
create it in a small `"use client"` component and render that from the
server. The hooks (`usePlot`, `useChartPlot`, `usePlugin`) are client-only,
as hooks are. SSR is fine: nothing here touches the DOM at import time.

## 60 seconds — one production-shaped chart

Candles, a volume pane, a moving average, a crosshair, a tooltip, a legend,
live updates, and responsive sizing. **Zero hooks, one line of wiring:**

```tsx
import { histogramSeries, timeTicks } from "@finchart/core";
import type { HistogramPoint, LineDataPoint, OHLC } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import {
  ChartCandles, ChartContainer, ChartLine, ChartPane, ChartSeries,
  Crosshair, Legend, Tooltip, XAxis, YAxis,
} from "@finchart/react";

declare const bars: OHLC[];              // whatever you bring
declare const volume: HistogramPoint[];

const deps = browserDeps({ autoSize: true });   // wiring is always explicit

// Build the points from the whole source array. The first 19 being null is
// half the point — drop those points instead and the line bridges the hole.
const sma20 = (source: OHLC[]): LineDataPoint[] =>
  source.map((bar, i) => ({
    x: bar.x,
    y: i < 19
      ? null
      : source.slice(i - 19, i + 1).reduce((sum, b) => sum + b.close, 0) / 20,
  }));

<ChartContainer deps={deps} data={bars} style={{ height: 480 }}>
  <XAxis ticks={timeTicks()} />
  <YAxis position="right" />

  <Crosshair magnet />
  <Tooltip />
  <Legend />

  <ChartPane>
    <ChartCandles name="Price" />
    <ChartLine derive={sma20} deriveKey={[20]} style={{ line: { color: "#f59e0b", width: 1.5 }, point: { radius: 0 } }} />
  </ChartPane>

  <ChartPane flex={0.25} minHeight={48}>
    <ChartSeries series={histogramSeries()} data={volume} name="Volume" />
  </ChartPane>
</ChartContainer>
```

**A line can get its points three ways** — `data` (you already have the
array), `derive` + `deriveKey` (compute them from the source, as above), or
`input` (connect a computed node someone else built). In practice the third is
the common one: `movingAverage(source, { period: 20 }).out.ma` from
`@finchart/indicators` is exactly the shape `input` wants, and that's how
bands and a middle line end up **sharing one calculation**.

**A series' look is the imperative lane's override shape.** `style` on
`<ChartLine>` is what `lineSeries(style)` takes — `{ line: { color, width,
dashArray }, point: { radius, color } }` — and `<ChartCandles style>` is
`candleSeries(style)`'s `{ up, down, wickWidth, bodyRatio }`. What you learn
in one lane holds in the other, and a field the core adds is reachable here
the same day. Omitted fields fall back to the CSS variables.

**Live updates are just a new array in `data`** — no imperative calls, no
refs. Preserving the viewport and following the newest bar mean the same thing
they do on the imperative path, and at 100k bars the cost difference is below
the noise floor. Pane heights come from `flex`, so you never do pixel
arithmetic yourself.

This example is **machine-checked**: the same code compiles in
`src/__tests__/minimal-service.types.tsx`, and `minimal.html` in
`apps/examples` runs it in a browser. Exactly one thing differs — the fixture
lives *inside* the package, so it imports from `'../components'`.

## What you need to know — four concepts, two lanes

| Concept | What it is | Examples |
|---|---|---|
| Container | One chart. The door for data, size, and state | `<ChartContainer>` |
| Pane | A region sharing a value axis. Height comes from `flex` | `<ChartPane>` |
| Series | The thing being drawn | `<ChartCandles>` · `<ChartLine>` · `<ChartSeries>` |
| Attachment | Something mounted onto the chart — axes, tools, decorations | `<XAxis>` · `<Crosshair>` · `<Tooltip>` · `<PriceLine>` |

**Two lanes** — things that *exist* on the chart are children; *commands* are
hooks:

| Hook | When |
|---|---|
| `usePlugin` | Install and tear down a plugin (`drawingTools`, `paneMaximize`, `attach*`) |
| `usePluginState` | Subscribe to a plugin's state as React state (tool mode, selection) |
| `useChartPlot` | Issue commands from **inside** the container (options, installs) |

`plotRef` is for event handlers (a `fitDomains()` button); `onPlot` is for
wiring **between** containers (`<SyncX>`) — see "Across containers" below.

## Wiring is always explicit

`deps` is **required.** That one line decides what enters your bundle —
**leave it out of the wiring and the code doesn't ship.** If we gave it
a default for convenience, this package would statically import
`browserDeps`, and then consumers who wired things leanly — plus headless and
worker builds — would carry the entire browser shell. Measured: +21.6KB raw /
+6.5KB gzip. We tried it once and reverted it the same day.

```tsx
// Need a bar-index x-axis and kinetic scrolling? You choose that here too.
const deps = browserDeps({ autoSize: true, createXMapping: barIndexX });
```

Viewport state can live outside the chart via `state` / `onStateChange` — for
URLs, undo, or syncing.

## The components don't render DOM

The only DOM is `<ChartContainer>`'s single div. For every other component,
**mounting registers, unmounting unregisters, and changing a prop updates.**
Canvas series aren't DOM elements, so they don't appear in DevTools and you
can't target one with a CSS selector. That's why theming (the default color
for every line) goes through CSS variables, while a one-off like "this
indicator is orange" is the `style` prop's `line.color`. A series' identity follows React's
`key` semantics exactly — same slot, same series.

Naming: the `Chart*` prefix marks structure and series (`ChartContainer`,
`ChartPane`, `ChartLine`, …); no prefix marks attachments (`XAxis`,
`Crosshair`, `Tooltip`, `PriceLine`, …).

Decorations (`PriceLine`, `Markers`, `Watermark`, `Span`) **don't rebuild when
their values are unchanged**, so writing them inline is fine.
`Crosshair`, `Tooltip`, and `Legend` can be inline too — those re-apply
options through `applyOptions` rather than rebuilding. Nested objects (like
`PriceLine`'s `style`) are compared by value as well, one level deeper.

Two exceptions:

- **`Markers`' `items`**: arrays are compared down to **element identity**. If
  you build them from stable data, that works as-is, but if you construct new
  `items` elements on every render you need `useMemo` — on a large list, a
  deep comparison gets more expensive than the drawing.
- **Function props** (like `PriceLine`'s `format`): there's no way to tell
  whether two closures do the same thing, so these fall back to identity. An
  inline `format={(v) => …}` is a new function every render and rebuilds every
  time — pin it with `useCallback` or a module-level constant.

## The two lanes: declarative and imperative

**Things that exist on the chart are children; commands are hooks.**

- **Declarative lane** — anything whose meaning is "present or absent"
  (series, panes, decorations, tool installs) is a component. React decides
  conditionals, lists, ordering, and identity. A `data` prop is applied in
  an effect, so a bad payload throws its `DataError` **outside** your
  render — into the nearest error boundary. Validate before rendering:
  `validateSeriesData(data, accessor)` returns the issues as a value, and
  the tick path has `validateSeriesPoint`.
- **Imperative lane** — a plugin's API handle, a one-shot command like
  `fitDomains()`, and subscriptions go through hooks and refs: `usePlugin`
  (install/teardown lifetime), `useChartPlot` (configuration from inside the
  container), `plotRef` (event handlers).

```tsx
const tools = usePlugin((plot, pane) => pane.use(drawingTools({ plot })), []);
// tools?.begin("trend") — the api arrives after commit
```

**A series handle is a `Source`.** When a pane is driven imperatively, the
handle `pane.addSeries(...)` returns is what an indicator reads — hand it to
`attach*` directly and the indicator sees everything the handle holds,
history brought in by `prepend` or `infiniteHistory` included (`useDataSource`
reads a React array, so an indicator on it sees only that array). The handle
is `null` before commit, and `usePlugin` lets `install` say "not yet" by
returning `null`, so the second hook installs on the render after the first
one's api arrives:

```tsx
const price = usePlugin((_, pane) => pane.addSeries({ series: candleSeries(), data }), []);
const rsi = usePlugin((plot) => price && plot.use(attachRsi({ source: price })), [price]);
```

The first hook's `data` is the initial seed — with `[]` for `deps` a later
array is not re-applied; feed the handle with `price.append(...)` /
`price.upsert(...)` instead.

**A pane has one owner.** If a pane contains even one `<ChartSeries>`, the
declarative lane owns that pane's series list — add an `addSeries` or an
`attach*` indicator (which uses `addSeries` internally) imperatively on top,
and the core throws a `ContractError` before either side is detached. Drive a
whole pane imperatively only when it has no series components. Indicators that create their own pane (RSI, MACD, and friends) can push
pane indices out of alignment when mixed with `<ChartPane>`, which breaks
saving and restoring `state` — so on screens that round-trip state, keep pane
structure in one lane.

## Across containers: `onPlot` and `<SyncX>`

The vocabulary *inside* a container assumes a single chart. Wiring that spans
**two or more** charts (x-axis sync for symbol comparison, say) lives outside,
and its input has to be **state**, not a ref: `plotRef` can't wake an effect,
so it can't react to charts appearing and disappearing. Put each chart into
state with `onPlot` and hand `<SyncX>` a fixed-length array (null for empty
slots):

```tsx
const [a, setA] = useState<Plot | null>(null);
const [b, setB] = useState<Plot | null>(null);
<ChartContainer onPlot={setA} …/>
<ChartContainer onPlot={setB} …/>
<SyncX plots={[a, b]} />
```

The split: **`plotRef` for event handlers** (by the time someone clicks, the
chart has settled), **`onPlot` for wiring** (it has to react to charts coming
and going). The `onPlot` callback needs a stable reference — a `useState`
setter is enough.

## Plot options, the value scale, and the theme

**Every plot option has one door.** `showGrid`, `gridStyle` and `paneGap`
are props; `axis` is `<XAxis>`/`<YAxis>`; the rest — `padding`,
`resizablePanes`, `shiftVisibleRangeOnNewBar`, `axisDrag`, `rightOffset`,
`minBarSpacing`, `maxBarSpacing` — go through `options`, and a key you drop
reverts to what the plot was built with (`minBarSpacing`/`maxBarSpacing` go
back to the x mapping's own default). `options` is applied before the first
series registers, so `rightOffset` shapes the first fit whatever the JSX
order — no `useChartPlot` + `useEffect` shim needed:

```tsx
<ChartContainer deps={deps} data={bars} options={{ shiftVisibleRangeOnNewBar: true, rightOffset: 5 }}>
```

**A pane's value scale is a prop.** `<ChartPane yScale={() => new LogScale()}>`
— a factory read once per acquisition (twice under StrictMode's replay), like
`deps.mainPaneYScale`, so an inline arrow is fine and the factory must be pure. `autoScale` and `invert` are props too; both are
directives applied when they change, and an axis drag turning a fixed range
on flips `autoScale` off on the pane the way a divider drag moves `flex`.
Two things saved `state` does not carry: the scale kind (persist it
alongside, and drop `valueDomain` when it differs — a domain the scale
cannot hold is a `ContractError` at the error boundary around the container),
and a `valueDomain` restored before the first data arrives, which the first
fit overwrites (restore after data, or through a later `state` change). And
one thing a scale swap does not announce: when the new scale cannot hold the
fixed range and refits to the data, no `stateChange` fires — read the domain
off the pane if you persist it at that moment.

**The theme is a prop.** Canvas colors are CSS variables read at draw time,
so a theme switch changes the axis labels at once and the candles only on the
next redraw. `<ChartContainer followTheme>` redraws on `prefers-color-scheme`
and on a `class` / `data-theme` / `style` change on the container or any
ancestor it had at mount — the shape next-themes and `data-theme` apps
produce. Off by
default; a fixed palette should not hold an observer.

## Imperative configuration: `useChartPlot`

Effects that install a tool or apply options belong in a **component inside
the container**, using `useChartPlot()`. Reading `plotRef` from a parent's
effect will catch an instance that's about to be thrown away on a `key`
remount (or StrictMode's double mount) — the contract is in the JSDoc on
`chart-context.ts`. `plotRef` is still the right tool for event handlers, like
that `fitDomains()` button.

## Advanced: `usePlot`

The low-level hook `<ChartContainer>` uses internally. Reach for it only when
you want to swap a single series through an imperative handle
(`SeriesHandle`) — most apps never need it. The contract is in the JSDoc on
`use-chart.ts`.

## Support matrix

- **Node 18+** — where the headless path (SSR, workers, tests) runs.
- **Browsers — Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03).
  The floor is set by `structuredClone`, `Object.hasOwn`, and
  `Array.prototype.at`, and **no polyfills ship** — bring your own if you need
  to support something older.
- **React 18+** — the peer range. CI runs both the floor (18) and the ceiling (19).
- The repository's own toolchain (Node 24 · pnpm 11) is higher than this. That
  is **the contributor's floor**, not the consumer's.

## Docs

- **Style tokens** — the full CSS variable table — [`theme.md`](https://github.com/finchart/finchart/blob/main/apps/docs/guide/theme.md)
- **The Plot contract** — [plot-contract.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/plot-contract.md)
- **Glossary** — [glossary.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/glossary.md)
