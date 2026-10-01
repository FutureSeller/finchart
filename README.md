# @finchart

**A financial chart library with candles, indicators, drawing tools, and real-time
updates.** The core knows nothing about frameworks; the React wrapper sits on
top of it. You can test it headless.

```
packages/core        @finchart/core        Chart engine (zero dependencies, no DOM)
packages/dom         @finchart/dom         Browser shell — the react-dom to core's react
packages/react       @finchart/react       React composable components
packages/indicators  @finchart/indicators  Indicators (MA·MACD·Bollinger) — the core API never grew for them
packages/tools       @finchart/tools       Drawing tools (horizontal·trend line·Fibonacci) — nor for these
apps/examples        Where you see it for yourself
```

## 30-second proof

**Test a chart — no browser, five lines.** Everyone else relies on screenshot diffing.

```ts
// Turn off showGrid — otherwise the grid is drawLine too, and find() picks up grid lines.
const model = createPlotModel({
  size,
  series: { series: lineSeries(), data },
  config: { showGrid: false },
});
const lines = model.commands().filter((c) => c.type === "drawLine");
expect(lines[0].points).toHaveLength(data.length);
```

**The view state is a single value.** What the user built with pan, zoom and
drag reads and writes through three contracts, so restore, undo and linking two
charts are all the same move.

```ts
const state = plot.getState();   // { xDomain, panes: [...] }
plot.applyState(state);          // fine before data arrives — it lands at the first fit
syncX(btcPlot, ethPlot);         // sync is a 30-line helper
```

**Extensions are built as packages.** The indicators and drawing-tools packages
were built **without the core API growing for them** — the only irrefutable proof that the
computed-node, input-stack, and plugin contracts are real.

## What's there

- **Series** — candle·line·histogram(volume)·area·baseline·OHLC bar, plus a
  2-method contract for building your own
- **Panes** — overlap or stack. Bar-index x-axis (no weekend gaps), time ticks
  (calendar boundaries·timezone·locale, using only `Intl`)
- **Interaction** — pan·zoom·pinch·axis drag·keyboard·double-click reset·kinetic
  (optional), every one individually toggleable
- **Real-time** — `updateLast` (ticks), `conflated` (a loud feed's repeated
  updates to one bar, folded until the next frame), seam-only incremental
  checks, `shiftVisibleRangeOnNewBar`
- **Decorations** — crosshair (magnet)·tooltip·legend·price line (axis badge)·
  markers·watermark·range highlight
- **Headless** — `createPlotModel` emits a command list without a DOM. The
  entry point for servers, workers, and tests. The browser shell is a separate
  package (`@finchart/dom`), so headless consumers don't even install it —
  core is complete at runtime and in its types without a DOM (CI's ssr-smoke +
  headless type smoke, zero global DOM type references)
- Theming via CSS variables, high-DPI support, one render per frame,
  `takeScreenshot`

> **Status: alpha.** The public API still changes — during 0.x, minor releases
> can carry breaking changes.

## Support matrix

| | Floor | What decides it |
|---|---|---|
| Node | **20.19+** | Where the headless path (SSR·workers·tests) runs; CI runs that floor |
| Browser | **Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03) | `structuredClone`·`Object.hasOwn`·`Array.prototype.at` |
| React (`@finchart/react`) | **18+** | Peer range. CI runs both the floor (18) and the ceiling (19) |

**No polyfills ship** — bring your own if you need to support something older.
And this table is **the consumer's floor**: what's needed to develop the
repository itself (Node 24 · pnpm 11) lives separately in the root
`package.json`'s `engines`.

## Getting started

```bash
pnpm add @finchart/core @finchart/dom
```

The five packages **ship as one fixed version** (`.changeset/config.json`'s
`fixed`) — `@finchart/dom@x.y.z` requires `@finchart/core@x.y.z` as a peer, so
mixing versions gets rejected at install. The code below runs as-is.

To work on the repo itself, use the clone steps in [Development](#development)
below. Coming from lightweight-charts? There is a
[side-by-side table](https://github.com/finchart/finchart/blob/main/apps/docs/guide/migrating-from-lightweight-charts.md).

## 60 seconds

```html
<div id="chart" style="height: 400px"></div>
```

The height matters: the canvas is layered over that element rather than laid
out in it, so an empty `<div>` stays 0 px tall and what follows it is drawn
over.

```ts
import { candleSeries } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";

const plot = PlotBuilder.create(browserDeps(), candleSeries())
  .addDataPoints([
    { x: 0, open: 100, high: 108, low: 98, close: 106 },
    { x: 1, open: 106, high: 112, low: 104, close: 109 },
    { x: 2, open: 109, high: 111, low: 101, close: 103 },
  ])
  .setSize(800, 400)
  .build(document.getElementById("chart")!);
```

That's it. Drag to pan, scroll to zoom.

> **Data must be in ascending x order.** Otherwise you get a `DataError` —
> slicing is a binary search, and unsorted data would render scrambled anyway.

> **To add indicators or update in real time, register the series with
> `addSeries` instead of the builder.** The shortcut above
> (`create(deps, series)` + `addDataPoints`) is for the 60-second "just show one
> candle series" case, so it **doesn't hand back a handle.** An indicator's
> `source` and `updateLast` both need that handle:
>
> ```ts
> const plot = PlotBuilder.create(browserDeps())
>   .setSize(800, 400)
>   .build(document.getElementById("chart")!);
>
> const price = plot.mainPane.addSeries({ series: candleSeries(), data: bars });
> price.updateLast(tick);                                        // real-time
> pane.use(attachMovingAverage({ source: price, period: 20 }));  // indicator
>
> // A loud feed — many ticks per frame — goes through a conflated feed instead:
> const feed = conflated(price);
> feed.push(tick);   // repeated updates to one bar are folded until the next frame, then updateLast
> ```
>
> Every `updateLast` copies the array, so fifty ticks between two frames pay
> fifty copies for a picture that shows only the last. `conflated` coalesces
> the repeated updates to the same bar until the next frame — a tick that
> opens a new bar delivers the previous bar at once; the price is that the
> screen follows the socket by two scheduling steps (the feed's frame, then
> the render's), and without `requestAnimationFrame` delivery is immediate. The [live feed guide](https://github.com/finchart/finchart/blob/main/apps/docs/guide/live-feed.md)
> has the whole wiring, including what to flush before a gap-fill.

## React

Children declare what to draw. Components don't render DOM — they just
register in an effect. (In a Next.js app the chart lives in one client file —
[Next.js and React apps](https://github.com/finchart/finchart/blob/main/apps/docs/guide/nextjs.md).)

```tsx
import { candleSeries, lineSeries } from "@finchart/core";
import type { LineDataPoint, OHLC } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { ChartContainer, ChartPane, ChartSeries, XAxis, YAxis } from "@finchart/react";
import { useMemo } from "react";

// Build the drawn points from the full source. The first 19 have no value yet,
// so they're null — dropping the points instead would draw a line across the gap.
const movingAverage20 = (source: OHLC[]): LineDataPoint[] =>
  source.map((bar, i) => ({
    x: bar.x,
    y: i < 19
      ? null
      : source.slice(i - 19, i + 1).reduce((sum, b) => sum + b.close, 0) / 20,
  }));

function Chart({ data }: { data: OHLC[] }) {
  // The reference doesn't need to be stable — identity is the JSX slot, and
  // deriveKey decides whether to recompute. deps is read once, at mount.
  const deps = useMemo(() => browserDeps(), []);
  const price = candleSeries();
  const ma = lineSeries({ line: { color: "#f59e0b" } });

  return (
    <ChartContainer deps={deps} data={data} width={800} height={400}>
      <XAxis />
      <ChartPane>
        <YAxis />
        <ChartSeries series={price} />
        {/* Overlays the price. deriveKey is what lets it know when to recompute. */}
        <ChartSeries series={ma} derive={movingAverage20} deriveKey={[20]} />
      </ChartPane>
    </ChartContainer>
  );
}
```

To put an indicator in **its own pane below**, add another `<ChartPane>`. Each
pane has its own value axis, and pan/zoom only ever touches x, so however many
panes you have, they move together automatically.

## Common recipes

**Adding a crosshair** — wires up the decoration and its event subscriptions in
one call. It's a plugin, so it's cleaned up automatically when the stage is
destroyed.

```ts
const line = plot.use(crosshair());
```

**Swapping data** — data belongs to the **registration**. You give it at
mount time, and to change it later you use the handle you got back. That's why
each series can draw different data.

```ts
const btc = plot.mainPane.addSeries({ series: candleSeries(), data: btcCandles });
const eth = plot.mainPane.addSeries({ series: lineSeries(), data: ethPrices });

btc.append([tick]);       // only btc grows. the domain stays put
```

**Loading more history** — `infiniteHistory` fetches older bars as the view
approaches the left edge and `prepend`s them; the cursor, the threshold and the
in-flight dedup are its. `from` is the first x you already hold.

```ts
const loader = infiniteHistory(plot, btc, loadBefore, { from: btcCandles[0].x });

// On a symbol switch or unmount, before btc goes:
loader.dispose();
```

Given the handle, a loader whose page is in flight when `btc` is disposed
stops by itself (`status()` reads `"stopped"`) instead of throwing. It looks at
the handle only when it asks for or lands a page, so an idle or finished loader
stays subscribed to the chart until you dispose it — do that on teardown,
whatever the sink.

**Reconciling a snapshot** — a REST snapshot of recent bars goes in through
`upsert`, merged by x: the bars it names are corrected or added, the ones it
does not name stay. Hand over closed bars only — the bar in progress is the
tick's — and only from the first bar you hold: older ones are history, and
history comes in through `prepend`. The [live feed guide](https://github.com/finchart/finchart/blob/main/apps/docs/guide/live-feed.md) has the
whole wiring — trades → `barAggregator` → `conflated` → `updateLast`, and what
to do on reconnect.

```ts
const first = btc.xRange?.min ?? Number.NEGATIVE_INFINITY;
btc.upsert(snapshot.filter((bar) => bar.x >= first && bar.x + INTERVAL <= Date.now()));
```

**Changing colors** — just put CSS variables on the container.

```css
.chart {
  --chart-candle-up: #16a34a;
  --chart-candle-down: #dc2626;
  --chart-grid: #e2e8f0;
  --chart-crosshair: #94a3b8;
}
```

The full variable table and dark-mode wiring are in
[theme.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/theme.md).

**Drawing your own series** — a `Series` is two methods. It doesn't know what
the renderer is, or whether there's even a canvas.

```ts
const mySeries: Series<LineDataPoint> = {
  valueExtent: (data) => ({ min: ..., max: ... }),   // how much of y it occupies
  draw: (target, { data, x, yScale }) => { ... },    // place it with x.toPixel(...)
};
```

Anything that isn't data (a crosshair, a range highlight, a watermark) is a
**decoration**, not a `Series` — the dividing line is whether it occupies the
value axis.

## Development

```bash
git clone https://github.com/finchart/finchart.git charts && cd charts
pnpm install
pnpm test          # all five packages
pnpm build
pnpm dev           # the examples app
```

The examples app includes candles, a moving average, a momentum pane, infinite
scroll, and a crosshair, all wired up.

## License

MIT
