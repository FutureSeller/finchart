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
server. The hooks (`usePlot`, `useChartPlot`, `usePlugin`, `usePluginState`,
`useDataSource`, `useInfiniteHistory`) are client-only, as hooks are. SSR is fine: nothing here touches the DOM at import time. The
whole picture — the client file, `deps` read once, hydration, StrictMode — is
in [Next.js and React apps](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/nextjs.md).

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
| Attachment | Something mounted onto the chart — axes, tools, decorations, history | `<XAxis>` · `<Crosshair>` · `<Tooltip>` · `<PriceLine>` · `<Plugin>` · `<InfiniteHistory>` |

**Two lanes** — things that *exist* on the chart are children; *commands* —
and the state and adapters around the chart — are hooks:

| Hook | When |
|---|---|
| `usePlugin` | Install and tear down a plugin (`drawingTools`, `paneMaximize`, `attach*`) from a component inside the container |
| `usePluginState` | Subscribe to a plugin's state as React state (tool mode, selection) |
| `useChartPlot` | Issue commands from **inside** the container (options, installs) |
| `usePlot` | Build a chart on your own element, without `<ChartContainer>` |
| `useDataSource` | Hand a React array to an indicator as a `Source` |
| `useInfiniteHistory` | Hold paged history as React state — it outlives a chart remount; a load is `reset(bars, { next, fetchPage })` and `<InfiniteHistory history>` pages it ([recipe](https://github.com/FutureSeller/finchart/blob/main/apps/docs/examples/infinite-history.md)) |

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

## The components don't render DOM

The only DOM is `<ChartContainer>`'s single div. For every other component,
**mounting registers, unmounting unregisters, and changing a prop updates.**
Canvas series aren't DOM elements, so they don't appear in DevTools and you
can't target one with a CSS selector. That's why theming (the default color
for every line) goes through CSS variables, while a one-off like "this
indicator is orange" is the `style` prop's `line.color`. A series' identity follows React's
`key` semantics exactly — same slot, same series.

Two exceptions to "changing a prop updates". A series' registration metadata —
`name`, `color` and `readout` — is fixed when it registers: changing one of
those on the same component leaves the tooltip and legend as they were; give
the component a new `key` to register it again. And `<Plugin>` reinstalls on
its `deps`, not on a new `install` or `onApi` — both are read when the api is
installed.

A derived or input series' `coordinates` accessor defines its registration's
reader. Changing that reference reinstalls the registration so drawing,
decimation and readouts agree; for a derived series this also rebuilds its
cached output. Keep a custom accessor stable when its meaning is unchanged.

The first `ChartPane` borrows the plot's persistent `mainPane`; later panes
are created and removed by their wrapper. Panes stack in JSX order: a `ChartPane` inserted above others, or keyed panes
reordered, move on the chart (`plot.setPaneOrder`) while keeping their
instances, series, scales and settings. `mainPane` retains its identity
wherever it lands.

The JSX owns the order of the panes it declares, but only when that order
changes: a `plot.setPaneOrder` you make through `plotRef` holds across
re-renders until some `ChartPane`'s place in the tree moves (a pane mounted
among them, one above it gone, keyed panes reordered), which restacks the
panes to the JSX again, once per commit. A pane added through `plotRef`
stays where you put it until then, and below the declared panes after.

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
  inline `format={(v) => …}` is a new function every render — `PriceLine` hands
  it to its decoration in place and asks for a frame, so it costs a render per
  render rather than a rebuild; pin it with `useCallback` or a module-level
  constant to make it free. `Watermark` and `Span` still rebuild on any change.

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

A tool install is a `<Plugin>` child; `onApi` hands its api to the parent —
after commit, and `null` before it's disposed — so a toolbar outside the
chart needs no component of its own just to call a hook inside it:

```tsx
const [tools, setTools] = useState<DrawingToolsApi | null>(null);

<ChartContainer deps={deps} data={bars}>
  <Plugin install={(plot) => plot.use(paneMaximize({ gestures: true }))} />
  <ChartPane>
    <Plugin<DrawingToolsApi> install={(plot, pane) => pane.use(drawingTools({ plot }))} onApi={setTools} />
  </ChartPane>
</ChartContainer>
<button onClick={() => tools?.begin("trend")}>Trend</button>
```

With a `useState` setter as `onApi`, name the api type as above —
TypeScript can't infer it from an inline `install` there; an `install`
declared with typed parameters needs nothing. `deps` decides reinstallation,
as with `usePlugin`; `install` and `onApi` are
read when the api is installed — the callback that heard it is the one told
it's gone — so inline arrows are fine. Inside a component that is
already in the container, `usePlugin` returns the api directly:

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
whole pane imperatively only when it has no series components. Indicators
that create their own pane (RSI, MACD, and friends) mix with `<ChartPane>`
freely: the panes they add stack below the declared ones.

**Refused data.** Declarative `data` the chart can't take — out of x order,
a non-finite value — is checked whole before any of it applies, so the chart
keeps what it had. Left alone, the `DataError` goes to the nearest error
boundary (around a Next.js page, that's the whole page). On a live screen,
hand it to `onError` instead: the chart keeps drawing its last good data and
the next good `data` lands as usual.

```tsx
<ChartContainer deps={deps} data={bars} onError={(error) => report(error)}>
```

Only data errors go there; a `ContractError` — a series that isn't one, a
wrong option — is a mistake in the code and still throws.

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
`resizablePanes`, `shiftVisibleRangeOnNewBar`, `preserveLiveRightEdgeOnZoomOut`,
`axisDrag`, `rightOffset`, `minBarSpacing`, `maxBarSpacing` — go through `options`, and a key you drop
reverts to what the plot was built with (`minBarSpacing`/`maxBarSpacing` go
back to the x mapping's own default). `options` is applied before the first
series registers, so `rightOffset` shapes the first fit whatever the JSX
order — no `useChartPlot` + `useEffect` shim needed:

```tsx
<ChartContainer deps={deps} data={bars} options={{ shiftVisibleRangeOnNewBar: true, rightOffset: 5 }}>
```

For a live view, `preserveLiveRightEdgeOnZoomOut: true` keeps zooming out from
growing the empty space to the right of the latest bar. It preserves the
current right edge, including a margin the user panned to; it does not snap
the chart to `rightOffset`. Historical windows and zooming in remain anchored
under the cursor. The option is off by default.

**A pane's value scale is a prop.** `<ChartPane yScale={log ? LOG : undefined}>` (with `const LOG = () => new LogScale()` at module level)
is the log toggle — the pane, its series and its height stay. The factory's
scale's declared `kind` is the change: the factory is called on updates, but
only a different kind is installed. Inline arrows are fine. Custom scales
must declare a stable `kind`. Removing the prop puts back a linear
scale (on the main pane, the instance it replaced). A fixed range is `valueDomain={[0, 100]}` — an
oscillator pane, declared like any other. `valueDomain`, `autoScale` and
`invert` are directives applied when they change (`valueDomain` by its two
numbers, so an inline array is fine; removing it hands the axis back to
`autoScale`), and an axis drag turning a fixed range
on flips `autoScale` off on the pane the way a divider drag moves `flex` — and
a double-click on that axis, or `fitDomains()`, flips it back on. To follow
those changes in React state (an "Auto" toggle that tracks an axis drag),
subscribe through `onPlot`:

```tsx
const [plot, setPlot] = useState<Plot | null>(null);
const [auto, setAuto] = useState(true);
useEffect(() => {
  if (!plot) return;
  const read = () => setAuto(plot.mainPane.autoScale);
  read();
  return plot.on("panesChange", read);
}, [plot]);
// <ChartContainer onPlot={setPlot} …>
```

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

- **Node 20.19+** — where the headless path (SSR, workers, tests) runs; CI runs that floor.
- **Browsers — Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03).
  The floor is set by `structuredClone`, `Object.hasOwn`, and
  `Array.prototype.at`, and **no polyfills ship** — bring your own if you need
  to support something older.
  Browser E2E runs current Playwright Chromium, Firefox, and WebKit. The
  historical floor versions and branded Edge/Safari are not separately run.
- **React 18+** — the peer range. CI runs both the floor (18) and the ceiling (19).
- The repository's own toolchain (Node 24.21+ · pnpm 12) is higher than this. That
  is **the contributor's floor**, not the consumer's.

## Docs

- **Style tokens** — the full CSS variable table — [`theme.md`](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/theme.md)
- **The Plot contract** — [plot-contract.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/plot-contract.md)
- **Glossary** — [glossary.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/glossary.md)
- **Next.js and React apps** — the client boundary, `deps` read once, SSR, StrictMode — [nextjs.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/nextjs.md)
- **Infinite history** — paging older data, in React with `useInfiniteHistory` — [infinite-history.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/examples/infinite-history.md)
- **Time zones and sessions** — [time-zones.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/time-zones.md)
- **Migrating from lightweight-charts** — [migrating-from-lightweight-charts.md](https://github.com/FutureSeller/finchart/blob/main/apps/docs/guide/migrating-from-lightweight-charts.md)
