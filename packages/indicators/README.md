# @finchart/indicators

Financial indicators built on `@finchart/core`'s computed nodes — MA (simple
and exponential), MACD, Bollinger Bands, RSI, ATR, Stochastic, VWAP, OBV, ADX,
Ichimoku, and Parabolic SAR. One calculation can feed several drawings
(`macd.out.signal`), and the `attach*` plugins reduce setup and teardown to a
single line. Oscillators (RSI, Stochastic) also wire up a fixed 0–100 axis and
reference lines when they get their own pane. The whole package was built
without a single commit to core — that's the proof those extension points are
real.

## Install

```sh
pnpm add @finchart/indicators @finchart/core
```
`@finchart/core` is a peer — install both.

- Cumulative indicators (VWAP, OBV) return `null` from the first bar that has
  no volume onward — they won't pretend to have a value. Only VWAP's `anchor`
  (a session reset) restarts the accumulation.
- Ichimoku's leading and lagging spans shift by index, not by inventing future
  x values — so no cloud is drawn past the last candle.

## Where the input comes from — the handle `addSeries` returns

**Every indicator asks for a `source`, and you already have one**: the handle
`addSeries` gives you back *is* a `Source`.

> One catch: if you mounted the series through the **60-second shortcut in the
> root README** (`PlotBuilder.create(deps, series)` plus `addDataPoints`), you
> don't have a handle — that path exists to put a single candle series on
> screen and returns nothing. Passing `plot.mainPane` as the `source` gets you
> `TS2741: Property 'read' is missing in type 'PaneApi'`. Do it the way shown
> below instead: give the builder no series, and mount with `addSeries`.
> Real-time updates (`updateLast`) and indicator input are **the same thing**,
> so the moment you mount a series you also have what an indicator needs.

```ts
const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true })).build(host);

// This handle is the Source — both lines below consume it.
const price = plot.mainPane.addSeries({ series: candleSeries(), data: bars, name: "Price" });

plot.mainPane.use(attachMovingAverage({ source: price, period: 20 })); // overlays on price
plot.use(attachRsi({ source: price }));                                // gets its own pane

price.updateLast({ x, open, high, low, close });  // the same handle is the real-time door
```

**Where you attach** is the difference between those two lines —
`plot.mainPane.use(...)` overlays onto that pane, while `plot.use(...)` gives
an oscillator a new pane of its own (RSI and Stochastic come with a fixed
0–100 axis and reference lines).

## Sharing one calculation — use the factory directly

`attach*` bundles "calculate + draw" into one line. **When several drawings
need to share one calculation**, use the factory instead and wire its outputs
(`out.*`) yourself — that way Bollinger's bands and middle line don't run the
same SMA twice.

```ts
const boll = bollingerBands(price, { period: 20 });
boll.out.band;    // Source — the bands
boll.out.middle;  // Source — the middle line (shares that one SMA)
```

In React these outputs are exactly the shape `<ChartLine input={...}>` and
`<ChartSeries input={...}>` expect.

To change a parameter, reinstall: `dispose()` and `use()` again with the new
options. Computed nodes are values, so recreating one is cheap.

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
