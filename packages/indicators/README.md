# @finchart/indicators

Financial indicators built on `@finchart/core`'s computed nodes — 35 of them:
moving average (simple and exponential), MACD, Bollinger Bands, RSI, ATR, ADX,
Parabolic SAR, Ichimoku, VWAP, OBV, Stochastic, Stochastic RSI, MFI, Ultimate
Oscillator, Awesome Oscillator, Momentum, Elder-Ray, Squeeze Momentum, ROC, TRIX, PSY, BBI, DMA, BRAR, VR, EMV, PVT, CR, KDJ, CCI,
Williams %R, Donchian Channels, Keltner Channels, SuperTrend and Pivot Points
— plus a
volume profile decoration and the candle derivations — Heikin-Ashi, Renko, Line
Break, Kagi and Point & Figure — with `atrPriceStep` to size Renko's brick,
Kagi's reversal and Point & Figure's box from the tape's own volatility.
[The matrix](#the-matrix--what-each-indicator-does-on-a-tick) says what each
one does on a tick. One calculation can feed several drawings
(`macd.out.signal`), and the `attach*` plugins reduce setup and teardown to a
single line. Oscillators (RSI, Stochastic) also wire up a fixed 0–100 axis and
reference lines when they get their own pane. The whole package was built
without the core API growing for it — that's the proof those extension points
are real.

## Install

```sh
pnpm add @finchart/indicators @finchart/core
```
`@finchart/core` is a peer — install both.

- A bar without volume is a gap, and the cumulative indicators treat it
  differently because their mathematics differ. **VWAP** is `null` from that
  bar until its next `anchor` (a session reset) — its weights are unknown, so
  it won't pretend to have a value. **OBV** is `null` on that bar only and
  resumes on the next: its absolute level is arbitrary by definition, so a
  gap costs exactly one bar's contribution (that bar's volume, signed by its
  direction — or nothing, if the close was unchanged); the level after it is
  off by that much, an arbitrariness of the same kind as the level itself,
  and every later up/down is real. **PVT** follows OBV's rule — `null` on the
  gap bar, the sum kept and resumed on the next bar against the previous
  close — and the sum starts at 0, which is what a bar with volume but no
  previous close reads.
- Ichimoku's leading and lagging spans shift by index — bar units, so a
  weekend gap is not counted. The cloud stops at the last candle unless you
  say what the bars after it are: `ichimoku(source, { ahead: (lastX, steps) =>
  lastX + steps * 60_000 })` runs the leading spans and the cloud
  `displacement` bars past it, at the x your feed would give those bars (a
  session's, a trading day's — the feed knows, this package does not). The
  chart's x range then reaches the projected cloud: `rightOffset` is room
  after it, and following a new bar (`shiftVisibleRangeOnNewBar`) tracks the
  cloud's end — a viewport that shows the last candle but not the cloud's
  end is not "at the end", so it does not follow; keep the cloud in view or
  turn the projection off.
- **Where the readings part from KLineChart**, the source for ROC, TRIX, PSY,
  VR, BBI, DMA, CR, BRAR, EMV, PVT and KDJ. A case the formula leaves
  undefined is `null`, never the 0 the canonical writes: ROC's zero reference
  close, VR's window with no down and no flat volume, CR's and BRAR's zero
  denominators, KDJ's flat window (the canonical divides by 1 there), PVT's
  zero previous close, TRIX's first rate of change. A first bar with no
  previous close is no observation — PSY's and VR's readings land one bar
  after the canonical's, which compares that bar with itself (VR counts its
  volume as flat). **EMV** takes one option (`period`), reads `null` on a
  bar with zero volume or zero range (the box ratio `volume / range` has no
  value at either) — one such bar removes one bar of `emv` and `period` bars
  of `signal` — and keeps the canonical's 1e8 volume scale; a package that
  uses another constant differs by that factor. **BRAR** clips `max(0, ·)`
  on BR only, and BR has no first bar, so it lands one bar after AR and one
  after the canonical.
  **CR** sums over the window (`SUM(…, N)`, the canonical's own docstring and
  the literature) where the canonical's code divides bar by bar; its four
  averages are drawn `ceil(p / 2.5 + 1)` bars back, so with the defaults CR
  reads from the 27th bar and MA(60) from the 111th. **KDJ** is its own
  factory, not a `stochastic` option: the same `{period, smooth, signal}`
  words, but Wilder-style recursions seeded at 50 — the same `k` reads a
  different number, and the label says which. **PVT**'s sum starts at 0 — a
  bar with volume but no previous close reads 0. The zero and 100 lines on
  own panes are the indicator's reading, not an option.

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

Two things about own panes. A legend reads one pane — `legend({})` is the
main pane's — so an own pane wants its own `legend({ pane })`. And every own
pane costs the price pane height: oscillators that share an axis can share a
pane instead — mount the first with `plot.use(...)`, the rest with
`pane: first.pane` (a borrowed pane is left exactly as it is, so the first
one's 0–100 axis and reference lines serve all three):

```ts
const rsi = plot.use(attachRsi({ source: price, ownPane: { stateKey: "oscillators" } }));
if (rsi.pane) {
  plot.use(attachMfi({ source: price, pane: rsi.pane }));
  plot.use(attachStochasticRsi({ source: price, pane: rsi.pane }));
  plot.use(legend({ pane: rsi.pane }));
}
```

`ownPane.stateKey` names the pane in persisted view state, so a saved layout
follows it instead of matching panes by position.

## Sharing one calculation — use the factory directly

`attach*` bundles "calculate + draw" into one line. **When several drawings
need to share one calculation**, build the node with the factory and hand it
to the attach — every `attach*` takes `{ node, name }` in place of
`{ source, ...options }` — and wire the node's other outputs (`out.*`)
yourself. Bollinger's bands and its middle line then run one SMA, and the
node is also what `api.node` returns:

```ts
const boll = bollingerBands(price, { period: 20 });
plot.mainPane.use(attachBollingerBands({ node: boll, name: "BB(20,2)", middle: false }));
plot.mainPane.addSeries({ series: lineSeries(), input: boll.out.middle, name: "MA(20)" });
```

A node does not carry its formula, so with `node` the `name` is yours to give
— `MA(20)` cannot be made up from a node — and the factory's options are not
taken (they are the node's already). Presentation stays: colours, `pane` /
`ownPane`, `levels`, the band's style. The two doors are exclusive: `{ source,
node }` is a type error. CR names its four averages `MA(w)` by window from a
source and `MA1`…`MA4` from a node (windows unknown) — `labels` names them.

**`MA(n)` and `BB(n)` share the middle line.** Bollinger's middle *is* the
SMA of its period over its input, so a simple `attachMovingAverage` of the
same period on the same input and pane sits exactly on top of it (an EMA, or
a different value accessor, does not) — it looks like the MA is missing. Either turn
the band's line off (`middle: false`) or draw one line from the shared node,
as above.

In React these outputs are exactly the shape `<ChartLine input={...}>` and
`<ChartSeries input={...}>` expect.

To change a parameter, reinstall: `dispose()` and `use()` again with the new
options — and with a `node`, build a new node with the new options first;
reinstalling the same node changes nothing. Computed nodes are values, so
recreating one is cheap.

From a source, every `attach*` names its series from the formula — `RSI(14)`,
`BB(20,2) Upper`, `Pivot R1` — so the legend can read them; from a node the
head is the `name` you give (and CR's averages are `MA1`…`MA4` or `labels`). Two instances of one
indicator on two sources would read the same; pass `name` to replace the head
of the label (the parts — `Upper`, `Signal`, `R1` — stay appended):

```ts
plot.mainPane.use(attachPivotPoints({ source: price, anchor: weekly, name: "Weekly" }));
// legend: Weekly P · Weekly R1 · Weekly S1 · …
```

Bollinger's and Keltner's band fill carries no name on purpose — the legend
shows the three lines, not a fourth row for the area between them.

The histogram outputs — MACD's `histogram`, `ao`, Squeeze's `momentum` — are
`HistogramPoint[]`: each bar carries its direction against the bar before it
as `tone` (`>=` is `up`, so a tie is up; the first value and a bar right
after a gap have none), and the theme picks the colour through
`--chart-histogram-up` / `--chart-histogram-down`. Passing one colour to the
`attach*` (`colors.histogram`, `color`, `colors.momentum`) keeps every bar in
that colour, as before. One known limit: with decimation on (the default is
M4), a bar's tone was judged against its neighbour in the data, not the one
drawn next to it on screen.

Squeeze Momentum's two squeeze states are **marker rows**, not values:
`squeezeOn` and `squeezeOff` are `0` while their state holds and `null`
otherwise, so both `null` is "no squeeze" (and the warmup). The `attach*`
draws them on the histogram's zero line without a legend name. To match the
widely used LazyBear script exactly — it multiplies the Bollinger deviation by
the Keltner multiplier — pass `bbMultiplier` equal to `kcMultiplier`.

## The matrix — what each indicator does on a tick

Every node takes the tail door on a tick. The ones built on folds step one
fold from a checkpoint (**increment** — the matrix says which); the windowed
rest re-run only the bars a tick can reach — the moved bars plus the window
behind them — and hand back the unchanged output objects (**recompute +
reuse**), so their consumers still read the tick as a tail change —
re-validating and re-mapping only the bar that moved. Either way a tick's
arithmetic is bounded by the window, not the history. Two rules hold for
all of them:

- **The node reads the shape of a change from point identity, not from
  the door it came through.** `updateLast` and `append` keep every earlier
  point object, so they are tail changes; a `setData` that hands back the
  same objects with only the last one new is a tail change too, while a
  `setData` of fresh objects is a full recompute. For the increments, a
  replacement deeper than the last bar falls back to a full recompute.
- **A history page (`prepend`) goes through the head door** where the row
  says ✓: the node re-runs the prefix plus its declared lookback and keeps
  the rest of its output as is. Where it says —, a landing recomputes.

`movingAverage` has a head door only for `type: "sma"`. All recursive
indicators recompute the full history on prepend, including EMA, MACD, RSI,
ATR, ADX, Stochastic RSI, Elder-Ray, TRIX and Keltner Channels. A fixed
decay horizon cannot bound the error relative to the current reading when
older seed prices are arbitrarily large; missing observations can also pause
the recursion. This costs a full-history calculation on a history page;
the tick paths in the table are unchanged.

Defaults are exported as constants so a settings panel can render them —
the same values the labels are built from — and so are the oscillators'
reference lines (`RSI_LEVELS`, `PSY_LEVELS`, `KDJ_LEVELS`, `STOCHASTIC_LEVELS`, `STOCHASTIC_RSI_LEVELS`,
`MFI_LEVELS`, `ULTIMATE_OSCILLATOR_LEVELS`, `CCI_LEVELS`, `WILLIAMS_R_LEVELS`),
which live with the `attach*` plugins because a level is a fact about the
screen. *Needs* names what the source
must carry beyond OHLC: `volume` on every bar, or an `anchor` predicate
(the period boundary is the consumer's knowledge).

| Indicator | Tick | Head door | Defaults | Needs |
|---|---|---|---|---|
| `movingAverage` | increment | ✓ | `MOVING_AVERAGE_DEFAULTS` | — |
| `macd` | increment | — | `MACD_DEFAULTS` | — |
| `bollingerBands` | recompute + reuse | ✓ | `BOLLINGER_DEFAULTS` | — |
| `rsi` | increment | — | `RSI_DEFAULTS` | — |
| `atr` | increment | — | `ATR_DEFAULTS` | — |
| `adx` | increment | — | `ADX_DEFAULTS` | — |
| `parabolicSar` | increment | — | `PARABOLIC_SAR_DEFAULTS` | — |
| `ichimoku` | recompute + reuse | ✓ | `ICHIMOKU_DEFAULTS` | — |
| `vwap` | increment | — | — | volume |
| `obv` | increment | — | — | volume |
| `stochastic` | recompute + reuse | ✓ | `STOCHASTIC_DEFAULTS` | — |
| `cci` | recompute + reuse | ✓ | `CCI_DEFAULTS` | — |
| `williamsR` | recompute + reuse | ✓ | `WILLIAMS_R_DEFAULTS` | — |
| `donchianChannels` | recompute + reuse | ✓ | `DONCHIAN_DEFAULTS` | — |
| `keltnerChannels` | increment | — | `KELTNER_DEFAULTS` | — |
| `superTrend` | increment | — | `SUPERTREND_DEFAULTS` | — |
| `pivotPoints` | increment | — | `PIVOT_POINTS_DEFAULTS` | anchor |
| `stochasticRsi` | increment | — | `STOCHASTIC_RSI_DEFAULTS` | — |
| `mfi` | increment | ✓ | `MFI_DEFAULTS` | volume |
| `ultimateOscillator` | increment | ✓ | `ULTIMATE_OSCILLATOR_DEFAULTS` | — |
| `awesomeOscillator` | increment | ✓ | `AWESOME_OSCILLATOR_DEFAULTS` | — |
| `momentum` | increment | ✓ | `MOMENTUM_DEFAULTS` | — |
| `elderRay` | increment | — | `ELDER_RAY_DEFAULTS` | — |
| `squeezeMomentum` | increment | ✓ | `SQUEEZE_MOMENTUM_DEFAULTS` | — |
| `roc` | increment | ✓ | `ROC_DEFAULTS` | — |
| `trix` | increment | — | `TRIX_DEFAULTS` | — |
| `psy` | increment | ✓ | `PSY_DEFAULTS` | — |
| `bbi` | increment | ✓ | `BBI_DEFAULTS` | — |
| `dma` | increment | ✓ | `DMA_DEFAULTS` | — |
| `brar` | increment | ✓ | `BRAR_DEFAULTS` | — |
| `vr` | increment | ✓ | `VR_DEFAULTS` | volume |
| `emv` | increment | ✓ | `EMV_DEFAULTS` | volume |
| `pvt` | increment | — | — | volume |
| `cr` | increment | ✓ | `CR_DEFAULTS` | — |
| `kdj` | increment | — | `KDJ_DEFAULTS` | — |

This table is held against the source by a repository check — a row that
disagrees with `factories.ts`, or an indicator without a row, fails the gate.

**A seed that is history: `parabolicSar`, `superTrend`, `obv`, `vwap`.**
These have no head door because there is no finite horizon to give one —
SAR seeds from the first two bars, SuperTrend picks its first direction at
the first bar with a valid ATR and carries it, OBV's level starts at the
first bar with volume and carries, and an unanchored VWAP accumulates from
the first bar it sees. A history page (`prepend`, `infiniteHistory`) can therefore change the
**whole** series: SAR dots and the SuperTrend regime flip, the OBV level
moves. That is the mathematics, not a defect — the level was arbitrary all
along and the new one is just as valid. Give `vwap` an `anchor` whose
boundaries do not move with history (`periodAnchor` over a session start) and
it resets at every session, so a page changes only the sessions it
completes; `pivotPoints` is anchored the same way — a period's levels come from the
period before it, so a page can change the first period you held (its
levels now have a period before them, and its own extremes gain the bars
the page completes) and the one after it, nothing later.
`ichimoku` has a finite horizon (`max(conversion, base, span)
− 1 + displacement` bars), so it lands a page through its own door.

Other exports with a row of their own, not computed nodes:

| Export | What it is |
|---|---|
| `volumeProfile` | a pane decoration — the traded volume over the visible range, in `VOLUME_PROFILE_DEFAULTS.bins` buckets |
| `heikinAshi` | a derivation `OHLC[] → OHLC[]` — feed the result to a candle series; `heikinAshiLast` is its tail, the `deriveLast` for that registration (`addSeries({ derive: heikinAshi, deriveLast: heikinAshiLast })`), so a tick folds one bar instead of the whole tape — there is no head door, a page changes bar 0's seed and every open after it |
| `renko` | a derivation `OHLC[] → RenkoBrick[]` — bricks on their own x axis (brick index), not time; register it with `derive` so ticks go in as candles (the guide's "Price-axis transforms"); a close 2⁴⁷ bricks or more from zero is refused — past that a brick is under the doubles' spacing at that price and could not move the level; a brick over half the largest double is refused too — its two-brick reversal would not fit the doubles |
| `lineBreak` | a derivation `OHLC[] → LineBreakBlock[]` — three-line break (`LINE_BREAK_DEFAULTS.lines`), blocks on their own x axis like renko's bricks; a reversal needs the close beyond the extreme of the last `lines` lines and opens where the last line opened (Nison's turnaround line) |
| `kagi` | a derivation `OHLC[] → KagiPoint[]` — one point per vertex on its own x axis, the last point the line's live end; `reversal` (an absolute price distance — a positive finite number, required) turns the line; `tone` is yang/yin (thick/thin), changing at `breakY` where a segment crosses the previous shoulder or waist |
| `kagiSeries` | a series for `kagi`'s points — one stepped line (the corner at the new x, the old price) at two widths, yang thick and yin thin (`KAGI_STYLE_SPEC`: the widths are its own, the colours the candle's), split inside a stroke at `breakY`; declares M4 decimation at four points per pixel (a pixel column keeps its first, lowest, highest and last vertex as they are — every vertex is a local extreme, so thinning by count would drop turns); a tone run that begins and ends inside one pixel column can still vanish with the vertices M4 leaves out, as a toned histogram bar's colour can |
| `pointAndFigure` | a derivation `OHLC[] → PointAndFigureColumn[]` — columns of X's (`tone: "up"`) and O's on an absolute grid of `boxSize` multiples, the `reversal` (`POINT_AND_FIGURE_DEFAULTS`, 3 boxes) starting the next column one box inside the last; close-based, so its columns are sparser than the high/low method's; a fractional `boxSize` (an ATR's) keeps the grid straight — levels are integers, priced by one multiplication, and a quotient within a relative 8 × 2⁻⁵² of an integer counts as that level — though its levels are then not round prices; the grid is absolute but the columns are path-dependent, so a history page can redraw columns past the seam |
| `atrPriceStep` | the step a chart's own volatility suggests — the last ATR of the tape as a price distance, the starting point for `renko`'s `brickSize`, `kagi`'s `reversal` and `pointAndFigure`'s `boxSize` (`period` required: which ATR is the step is the caller's call); fewer bars than `period`, or an ATR that is no step (0 on a flat tape, under 2⁻¹⁰²² — the least the strictest transform accepts — or over half the largest double, past which `renko` cannot lay its two-brick reversal), is refused here so a transform never fails under a name that is not its own — what comes out passes the three transforms' option doors (`renko` and `pointAndFigure` also hold the prices to within 2⁴⁷ steps of zero, under their own names); the step follows the tape's recent volatility — for a period above 1, Wilder's average decays older true ranges exponentially (a bar's weight halves every `ln 2 / ln(period/(period − 1))` bars, about nine for 14), so the last window weighs most and older history still counts (a period of 1 is the last true range alone): pass the source you will draw; what the step sizes is the tape's travel along the price axis, in steps — `renko` lays a brick per step of travel, `pointAndFigure` a box per step in as many columns as reversals, `kagi` a line per reversal (at most one vertex per bar) — near the bar count with the ATR step on a tape whose volatility is even, multiplied by a hand-picked step far below the average move; to size a chart, count the transform's output on that source; the classic P&F box tables are not shipped, they differ by market |
| `pointAndFigureSeries` | a series for `pointAndFigure`'s columns, given the same `boxSize` — the data door holds each column's ends to the grid of it (a level under 2⁴⁷ boxes from zero, priced as the transform prices it), its span to `boxes` and its `open`/`close` to its `tone`, so an end off the grid or a different box is refused whenever the columns do not fit it too (a one-box column at 100 fits a box of 1 and of 2 alike; that one the door cannot tell) — an X per box as two strokes, an O as a twelve-sided ring, colours the candle's and the stroke width `--chart-pnf-width` (`POINT_AND_FIGURE_STYLE_SPEC`); it assumes of the value axis only what every series does, that it is monotone: the boxes whose cells reach into the pane are found by binary search on their edges' pixels, each cell is measured from its own price to its edges on the axis it is drawn on, and a run of cells under 4 px becomes one bar — judged by halving, since a stretch spanning fewer than 4 px holds no legible cell (on a log axis a column can be glyphs below and a bar above; the box holding zero, which a log axis folds, measures nothing) — so a frame costs at most the pane's cells at that floor, the partly visible box at each edge of a column, and a bar per run, and the axis is asked, per column, about the window (log₂ of its boxes, twice) and once per stretch the halving looks into — at most the pane's height over 4 px, plus two, per level of halving (some seven thousand for a 600 px pane and a 2⁴⁷-box column, a few hundred for a real one), never once per box; the candle's accessor (`close` is the value, `low`..`high` the span) and its own `PnfAggregation` at one column per pixel — buckets are merged into one column spanning their boxes (`boxes` becomes that span), never thinned |
| `periodAnchor` | the `anchor` predicate `vwap` and `pivotPoints` take, built from any rule about where a bar starts — `periodAnchor({ barStart })`, and core's `sessionStart({ timeZone })` is the rule for a market whose period is a calendar day in one place. It compares a bar with the one before it, so it finds a session that opens at 05:00Z where `bar.x % 86_400_000 === 0` cannot, and a clock that merely moved does not open one. The app owns its calendar; this owns the comparison. The rule is reusable, but it is not the same rule twice: a `BarStart` handed to `barAggregator` says how wide a candle is, one handed here says how long an indicator accumulates before it resets, and the aggregator's minute grid handed here would reset VWAP on every bar it drew. Why the modulo fails, what it does with the first bar, and which x a producer refuses are in the doc comment on `periodAnchor` — this row does not repeat them |

## Support matrix

- **Node 20.19+** — where the headless path (SSR, workers, tests) runs; CI runs that floor.
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
