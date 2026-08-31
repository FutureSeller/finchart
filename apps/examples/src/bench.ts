/**
 * The harness that measures render cost.
 *
 * A scenario is a `build` (stand the chart up) and a `step` (change something
 * every frame). What gets measured is one `render()` after the step — a new
 * path only has to be added to the scenario array.
 *
 * What it measures: frame time (one render() after the step) and the commit
 * share (a second run through an instrumented renderer).
 *
 * Allocation is not measured here — `performance.memory` freezes during
 * synchronous work, so it is useless per frame. Leaving `window.__harness`
 * open lets the driver read allocation and allocation sites directly over CDP
 * (`e2e/bench-driver.mjs`).
 *
 * Don't try to read a steady-state heap with rAF plus a wait — Chrome caches
 * the value and it genuinely doesn't move. If you need heap numbers, CDP is
 * the only way.
 *
 * The measurement scope is the main thread. Raster and compositing live in
 * other processes and are not caught here.
 */
import { browserDeps, createDomLayers, PlotBuilder } from "@finchart/dom";
import { barIndexX, candleSeries, computation, conflated, createCanvasRenderer, createPlotDeps, crosshairLine, LINEAR_GRADIENT, lineSeries, manualScheduler, noStyle, paintLinearGradient, Plot, seriesSpec, syncCrosshair, syncX, type ConflatedFeed, type CrosshairLine, type DataView, type DrawSurface, type LineDataPoint, type OHLC, type SeriesHandle, type Renderer, type RendererFactory, type SchedulerFactory } from "@finchart/core";
import { tooltip } from "@finchart/dom";
import { smaFold, type SmaState } from "@finchart/indicators";
import { drawingTools } from "@finchart/tools";

const WIDTH = 1200;
const HEIGHT = 600;
const WARMUP = 30;
const ITERATIONS = 200;

/** Only an explicitly called render() runs — no frame may slip in outside the measurement. */
const inertScheduler: SchedulerFactory = () => ({
  request: () => undefined,
  cancel: () => undefined,
});

interface Stats {
  mean: number;
  median: number;
  p95: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

  return {
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: at(50),
    p95: at(95),
    max: sorted[sorted.length - 1],
  };
}

/** Reproducible randomness — measuring different data each run makes nothing comparable. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reuses data once built — measuring a cold start means standing the same
 * chart up many times, and generating 100k points each time would cost more
 * than what's being measured. It hands back a copy because a chart holds onto
 * the array: share the original and what one scenario touched leaks into the
 * next.
 */
const candleCache = new Map<string, OHLC[]>();

function candles(count: number, seed = 42, startX = 0, startPrice = 100): OHLC[] {
  const key = `${count}:${seed}:${startX}:${startPrice}`;
  let made = candleCache.get(key);
  if (!made) {
    made = makeCandles(count, seed, startX, startPrice);
    candleCache.set(key, made);
  }
  return made.slice();
}

function makeCandles(count: number, seed = 42, startX = 0, startPrice = 100): OHLC[] {
  const random = mulberry32(seed);
  const out: OHLC[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + (random() - 0.5) * 0.04);
    const high = Math.max(open, close) * (1 + random() * 0.01);
    const low = Math.min(open, close) * (1 - random() * 0.01);

    out.push({ x: startX + i, open, high, low, close });
    price = close;
  }

  return out;
}

/**
 * An instrumented renderer must draw the same picture as an uninstrumented
 * one. An older wrapper copied `Renderer`'s optional members (clip,
 * drawCustom) across by hand and missed some — a missing clip didn't cut at
 * the pane boundary, which understated the commit share on small canvases
 * (sparklines), and a missing drawCustom would have measured the fallback path
 * had there been an area or gradient series (there is none in this suite, so
 * no number was actually wrong). The big-chart figures were unaffected.
 *
 * To keep that from recurring, the forwarding object is pinned to
 * `Required<Renderer>` — add a member and the build breaks right here.
 */
type CompleteRenderer = Required<Renderer>;

function instrumented(
  surface: DrawSurface,
  hook: (inner: Renderer) => Partial<CompleteRenderer>,
): Renderer {
  // The same wiring as browserDeps — drop a painter and you measure a different picture.
  const inner = createCanvasRenderer(surface, {
    painters: { [LINEAR_GRADIENT]: paintLinearGradient },
  });

  const forward: CompleteRenderer = {
    clear: () => inner.clear(),
    commit: () => inner.commit(),
    clip: (area) => inner.clip?.(area),
    drawLine: (points, style) => inner.drawLine(points, style),
    drawShape: (shape) => inner.drawShape(shape),
    drawText: (params) => inner.drawText(params),
    drawCustom: (draw) => inner.drawCustom?.(draw),
  };

  return { ...forward, ...hook(inner) };
}

function countingRenderer(box: { points: number }): RendererFactory {
  return (surface) =>
    instrumented(surface, (inner) => ({
      drawLine: (points, style) => {
        box.points += points.length;
        inner.drawLine(points, style);
      },
      drawShape: (shape) => {
        box.points += 1;
        inner.drawShape(shape);
      },
      drawText: (params) => {
        box.points += 1;
        inner.drawText(params);
      },
    }));
}

/** A wrapper that times commit() alone. The total comes from a separate uninstrumented run. */
function timingRenderer(box: { commit: number }): RendererFactory {
  return (surface) =>
    instrumented(surface, (inner) => ({
      commit: () => {
        const start = performance.now();
        inner.commit();
        box.commit += performance.now() - start;
      },
    }));
}

// --- Scenarios ---

interface Subject {
  plot: Plot;
  /** Where a hover step feeds the cursor. A step that doesn't use it ignores it. */
  crosshair: CrosshairLine;
  /**
   * The registrations that hold data (the candles, plus indicators holding
   * their own source) — appending to all of them every tick is what reproduces
   * the real load. A branch mounted through a computation node holds no data,
   * so it is excluded. The point type differs per registration, so only
   * append/prepend/updateLast are picked up.
   */
  handles: Pick<SeriesHandle<OHLC>, "append" | "prepend" | "updateLast">[];
}

/** Stands the chart up. The renderer factory has to reach `deps` unchanged for commit to be measured. */
type Build = (host: HTMLElement, createRenderer?: RendererFactory) => Subject;

/** Changes state every frame. The render() after this is what gets measured. */
type Step = (subject: Subject, frame: number) => void;

interface Scenario {
  name: string;
  build: Build;
  step: Step;
  /**
   * Tears down every chart this scenario stood up. For a scenario that stands
   * up several (the sparkline list, say), `subject.plot` is only the first, so
   * the rest went uncollected and once polluted the next scenario's numbers.
   * Without this, the harness destroys `subject.plot` alone.
   */
  dispose?: () => void;
}

interface ChartOptions {
  /** The full surface — drawing tools and the tooltip mounted on top too. */
  fullSurface?: boolean;
  points: number;
  maxPoints?: number;
  /** Points per pixel for the derived series (the indicator lines). */
  pointsPerPixel?: number;
  /** Whether to pre-stack the halved tiers. A zoomed-out pan becomes budget-sized work. */
  tiered?: boolean;
  /** How many moving averages — the first two overlay the main pane; each one after that adds a pane. */
  indicators?: number;
  /** Point radius for line series. Omit for the default (3). */
  pointRadius?: number;
  /**
   * Whether the value axis follows the visible range (on by default).
   * Auto-scaling walks every series' valueExtent again each frame — absolute
   * values swing 20~25% between sessions, so on and off only compare when
   * measured side by side in one session.
   */
  autoScale?: boolean;
  /**
   * How to mount a MACD-shaped indicator — this is where the computation node
   * gets measured.
   * - "derive": each series derives, repeating the same computation once per
   *   branch.
   * - "computation": one computation node produces every branch (computed
   *   once).
   * Moving averages don't show the difference, since their windows differ —
   * it only appears when one computation feeds several pictures.
   */
  macd?: "derive" | "computation";
  /**
   * Whether to wire the bar-index coordinate system (continuous x is the
   * default). Only bar-index mapping has a `rebuild`, so it re-counts every
   * series' x on each tick — continuous x doesn't pay that. The trading screen
   * really does use `barIndexX`, so without this option that path never gets
   * measured.
   */
  barIndexed?: boolean;
  /** How many extra horizontal lines to mount — a drag frame costs shape count × segment distance. */
  drawings?: number;
}

/**
 * Builds MACD's three branches — a heavy computation that folds EMA several
 * times. Hang a `derive` on each branch and this function runs once per
 * branch; a computation node runs it once and shares the result.
 */
function macdWays(source: DataView<OHLC>): {
  macd: LineDataPoint[];
  signal: LineDataPoint[];
  histogram: LineDataPoint[];
} {
  const ema = (values: number[], window: number): number[] => {
    const k = 2 / (window + 1);
    const out: number[] = [];
    let previous = values[0] ?? 0;

    for (const value of values) {
      previous = value * k + previous * (1 - k);
      out.push(previous);
    }
    return out;
  };

  const closes = source.map((candle) => candle.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = fast.map((value, i) => value - slow[i]);
  const signal = ema(line, 9);

  const at = (values: number[]): LineDataPoint[] =>
    source.map((candle, i) => ({ x: candle.x, y: values[i] }));

  return {
    macd: at(line),
    signal: at(signal),
    histogram: at(line.map((value, i) => value - signal[i])),
  };
}

/**
 * A moving average — one fold yields both shapes, `derive` (the whole thing)
 * and `deriveLast` (the tail). Both stand on the same `smaFold`, so by
 * construction they cannot diverge. The checkpoints are just before the last
 * step (`beforeLast`, for resuming a replacing tick) and at the end (`atEnd`,
 * for resuming a new bar) — each registration holds its own.
 *
 * During warmup (history shorter than the window) the output isn't 1:1 with
 * the source's tail, but this harness always has far more history than window,
 * so it never steps on that boundary.
 */
function smaSeries(window: number): {
  derive: (source: DataView<OHLC>) => LineDataPoint[];
  deriveLast: (
    previous: DataView<LineDataPoint>,
    source: DataView<OHLC>,
    change: { kind: "append" | "replace"; count: number },
  ) => LineDataPoint[];
  deriveFirst: {
    lookback: number;
    head: (
      previous: DataView<LineDataPoint>,
      source: DataView<OHLC>,
      change: { kind: "prepend"; count: number },
    ) => LineDataPoint[];
  };
} {
  let beforeLast: SmaState | null = null;
  let atEnd: SmaState | null = null;
  const tail = smaFold(window);

  const derive = (source: DataView<OHLC>): LineDataPoint[] => {
    const fold = smaFold(window);
    const out: LineDataPoint[] = [];
    for (let i = 0; i < source.length; i++) {
      if (i === source.length - 1) beforeLast = fold.snapshot();
      const y = fold.step(source[i].close);
      if (y !== null) out.push({ x: source[i].x, y });
    }
    atEnd = fold.snapshot();
    return out;
  };

  const deriveLast = (
    _previous: DataView<LineDataPoint>,
    source: DataView<OHLC>,
    change: { kind: "append" | "replace"; count: number },
  ): LineDataPoint[] => {
    const count = change.kind === "replace" ? 1 : change.count;
    const resume = change.kind === "replace" ? beforeLast : atEnd;
    if (!resume) return derive([...source]).slice(-count);

    tail.restore(resume);
    const out: LineDataPoint[] = [];
    for (let i = source.length - count; i < source.length; i++) {
      if (i === source.length - 1) beforeLast = tail.snapshot();
      // History ≫ window, so there are no warmup nulls — if there were, they'd go out as whitespace.
      out.push({ x: source[i].x, y: tail.step(source[i].close) });
    }
    atEnd = tail.snapshot();
    return out;
  };

  /**
   * A landing's head. Warmup nulls are dropped (see `derive`), so the old
   * head outputs never change on a prepend — the output is 1:1 with the
   * source *shifted by the warmup*, and `lookback` is 0: `count` source
   * points landing means exactly `count` outputs landing (count − w + 1
   * from the new points once their window fills, plus w − 1 at the old
   * source's former warmup, which only now has a full window behind it).
   */
  const deriveFirst = {
    lookback: 0,
    head: (
      _previous: DataView<LineDataPoint>,
      source: DataView<OHLC>,
      change: { kind: "prepend"; count: number },
    ): LineDataPoint[] => {
      const fold = smaFold(window);
      const upto = Math.min(change.count + window - 1, source.length);
      const out: LineDataPoint[] = [];
      for (let i = 0; i < upto; i++) {
        const y = fold.step(source[i].close);
        if (y !== null) out.push({ x: source[i].x, y });
      }
      return out;
    },
  };

  return { derive, deriveLast, deriveFirst };
}

/** One ordinary chart — candles plus a few moving averages. */
function candleChart(options: ChartOptions): Build {
  return (host, createRenderer) => {
    const plot = PlotBuilder.create<OHLC>(
      browserDeps({
        maxPoints: options.maxPoints,
        pointsPerPixel: options.pointsPerPixel,
        tiered: options.tiered,
        createXMapping: options.barIndexed ? barIndexX : undefined,
        createScheduler: inertScheduler,
        createRenderer,
      }),
    )
      .setSize(WIDTH, HEIGHT)
      .build(host);

    const crosshair = crosshairLine();
    plot.addDecoration(crosshair);

    const data = candles(options.points);
    // Candles merge to one pixel per bar — that policy comes along with candleSeries().
    const price = plot.mainPane.addSeries({ series: candleSeries(), data });
    const handles: Pick<SeriesHandle<OHLC>, "append" | "prepend" | "updateLast">[] = [price];

    const style =
      options.pointRadius === undefined
        ? undefined
        : { point: { radius: options.pointRadius } };

    for (let i = 0; i < (options.indicators ?? 0); i++) {
      const window = 20 + i * 10;
      const registration = {
        series: lineSeries(style),
        data,
        ...smaSeries(window),
      };

      handles.push(
        i < 2
          ? plot.mainPane.addSeries(registration)
          : plot.addPane({ flex: 0.4 }).addSeries(registration),
      );
    }

    if (options.macd) {
      const lower = plot.addPane({ flex: 0.4 });
      const ways = ["macd", "signal", "histogram"] as const;

      if (options.macd === "computation") {
        // Runs once and hands out the branches.
        const node = computation({ inputs: [price], calc: macdWays });
        for (const way of ways) {
          lower.addSeries({ series: lineSeries(style), input: node.out[way] });
        }
      } else {
        // Each branch derives on its own — the same EMA is folded three times.
        for (const way of ways) {
          handles.push(
            lower.addSeries({
              series: lineSeries(style),
              data,
              derive: (source: DataView<OHLC>) => macdWays(source)[way],
            }),
          );
        }
      }
    }

    if (options.autoScale === false) {
      for (const pane of plot.panes) pane.applyOptions({ autoScale: false });
    }

    /**
     * Draw once before handing it over — the range is settled inside
     * `render()`, so calling `panByPixels` before that reads the width as 1px
     * and flings the first frame off the data.
     */
    if (options.fullSurface) {
      // The full setup — drawing tools and a tooltip on top of the indicators.
      const tools = plot.mainPane.use(drawingTools({ plot }));
      tools.add({ type: "horizontal", price: 100 });
      tools.add({
        type: "trend",
        a: { x: options.points * 0.2, price: 90 },
        b: { x: options.points * 0.8, price: 110 },
      });
      tools.add({
        type: "fib",
        a: { x: options.points * 0.4, price: 120 },
        b: { x: options.points * 0.6, price: 80 },
      });
      for (let i = 0; i < (options.drawings ?? 0); i++) {
        // Spread evenly across the value range (90~120) — every one is a live hit-test candidate.
        tools.add({ type: "horizontal", price: 90 + (i % 30) });
      }
      plot.use(tooltip());
    }

    plot.render();

    return { plot, crosshair, handles };
  };
}

/**
 * A drag that really goes through the input router. Hover heads straight for
 * `crosshair.follow`, so no other scenario measures the consumer stack,
 * capture, or hit testing (`gripAt`). A drag walks all of it every frame
 * (shape count × segment distance + moveGrip + changed + re-render).
 *
 * It grabs the price line at 100 on the first frame and then shakes it up and
 * down — there is no pointerup, so the capture stays alive.
 */
const dragDrawing: Step = ({ plot }, i) => {
  const pane = plot.mainPane;
  const x = (pane.area.left + pane.area.right) / 2;
  if (i === 0) {
    plot.routeInput({
      type: "pointerdown",
      point: { x, y: pane.pixelAtValue(100) },
      pointerId: 1,
    });
    return;
  }
  plot.routeInput({
    type: "pointermove",
    point: { x, y: pane.pixelAtValue(100 + (i % 2 === 0 ? 5 : -5)) },
    pointerId: 1,
  });
};

/** Only the cursor moves. Neither the data nor the domain changes. */
const hover: Step = ({ crosshair }, i) => {
  crosshair.follow({ x: 100 + (i % 900), y: 80 + ((i * 7) % 400) });
};

/** A hover that goes through events — plot.crosshair also runs its subscribers (tooltip DOM updates, the probe). */
const hoverThroughEvents: Step = ({ plot, crosshair }, i) => {
  const position = { x: 100 + (i % 900), y: 80 + ((i * 7) % 400) };
  plot.crosshair(position);
  crosshair.follow(position);
};

/**
 * Drags left and right (reversing every 60 frames, staying over the data).
 * Unlike hover, the x domain changes, so every frame re-slices, re-decimates
 * and recomputes ticks.
 */
const pan: Step = ({ plot }, i) => {
  plot.panByPixels(i % 120 < 60 ? 4 : -4);
};

/** Holds the center and zooms in and out. The domain width changes too. */
const zoom: Step = ({ plot }, i) => {
  plot.zoomAtPixel(i % 120 < 60 ? 1.01 : 1 / 1.01, WIDTH / 2);
};

/**
 * A live tick — appends one candle per frame. `append` rebuilds the whole
 * array and checks the sort contract exhaustively, so the question is whether
 * the cost scales with how much history is held. With indicators mounted, each
 * appends to its own source and recomputes.
 */
function appendTick(startX: number): Step {
  let next = startX;

  return ({ handles }) => {
    const [candle] = makeCandles(1, next, next, 100);
    for (const handle of handles) handle.append([candle]);
    next += 1;
  };
}

/**
 * A prepend — the shape of infinite scroll receiving a page. Puts 500 bars on
 * the front each frame: continuous x only validates the sort, while bar index
 * also rebuilds the index (a prepend is outside the fast path by design — it
 * always walks the whole thing again).
 */
function prependChunk(): Step {
  let first = 0;

  return ({ handles }) => {
    first -= 500;
    const chunk = makeCandles(500, first, first, 100);
    for (const handle of handles) handle.prepend(chunk);
  };
}

/**
 * A tick on the bar in progress — a new value seated at the same x. Unlike
 * `appendTick` (a new bar every frame), this is what most of a real feed is:
 * while one bar is open it updates several times a second, and the bar itself
 * changes once a minute. A new bar has to rebuild the bar-index index, but a
 * tick on the same bar leaves the set of x values alone, so there is nothing
 * to count.
 */
function replaceTick(lastX: number): Step {
  let close = 100;

  return ({ handles }) => {
    close = close === 100 ? 101 : 100;
    const [candle] = makeCandles(1, lastX, lastX, close);
    for (const handle of handles) handle.updateLast(candle);
  };
}

/**
 * The two lanes a live tick can take. React's declarative path hands a "new
 * array with only the last bar changed" through the data prop every tick —
 * syncSeries → the full feed path (two copies plus an exhaustive sort check,
 * with no incremental detection). The imperative `updateLast` is a seam path
 * and is independent of history size. The same tick goes down both lanes to
 * measure whether the difference scales with data length (the React wrapper's
 * re-render cost is a constant independent of size, so it isn't a variable in
 * this question).
 */
function liveTickPair(points: number): Pair {
  const chart = (register: (plot: Plot, data: OHLC[]) => void): Build => {
    return (host, createRenderer) => {
      const plot = PlotBuilder.create<OHLC>(
        browserDeps({ createScheduler: inertScheduler, createRenderer }),
      )
        .setSize(WIDTH, HEIGHT)
        .build(host);
      const crosshair = crosshairLine();
      plot.addDecoration(crosshair);
      register(plot, candles(points));
      return { plot, crosshair, handles: [] };
    };
  };

  const tickOf = (previous: OHLC, frame: number): OHLC => ({
    ...previous,
    close: previous.close * (1 + ((frame % 7) - 3) * 0.001),
  });

  let price: SeriesHandle<OHLC> | null = null;
  let lastBar: OHLC | null = null;

  const series = candleSeries();
  let held: OHLC[] = [];

  return {
    question: `Live tick, ${points.toLocaleString("en")} points: declarative feed (whole array) against updateLast`,
    baseline: {
      name: "updateLast",
      build: chart((plot, data) => {
        lastBar = data[data.length - 1];
        price = plot.mainPane.addSeries({ series: candleSeries(), data });
      }),
      step: (_subject, frame) => {
        if (!price || !lastBar) throw new Error("build has to run first");
        lastBar = tickOf(lastBar, frame);
        price.updateLast(lastBar);
      },
    },
    variant: {
      name: "declarative feed",
      build: chart((plot, data) => {
        held = data;
        plot.mainPane.syncSeries([seriesSpec<OHLC>({ id: "price", series, data })]);
      }),
      step: ({ plot }, frame) => {
        const previous = held[held.length - 1];
        // Exactly the shape a React consumer produces — a new array with only the last entry changed.
        held = held.slice(0, -1).concat(tickOf(previous, frame));
        plot.mainPane.syncSeries([
          seriesSpec<OHLC>({ id: "price", series, data: held }),
        ]);
      },
    },
  };
}

/**
 * A live four-up multi-chart — the real frame interval when four charts on
 * linked wiring (syncX + syncCrosshair) each take a tick per frame and the hub
 * fans a hover out as well. The harness renders only `subject.plot`, so the
 * step renders the other three itself.
 */
function multiChartLive(points: number, count: number): Scenario {
  interface Member { plot: Plot; tick: (frame: number) => void }
  let members: Member[] = [];

  return {
    name: `four-up live · ${Math.round(points / 1000)}k×${count} (linked)`,
    /**
     * Tears down all four — `build` returns only `members[0].plot`, so the
     * harness's `subject.plot.destroy()` collects just the first. Leave the
     * other three and the syncX/syncCrosshair wiring survives as GC pressure on
     * whatever is measured next.
     */
    dispose: () => {
      for (const member of members) member.plot.destroy();
      members = [];
    },
    build: (host) => {
      members = [];
      for (let i = 0; i < count; i++) {
        const cell = document.createElement("div");
        cell.style.cssText = `position:absolute; width:${WIDTH / 2}px; height:${HEIGHT / 2}px; left:${(i % 2) * (WIDTH / 2)}px; top:${Math.floor(i / 2) * (HEIGHT / 2)}px;`;
        host.appendChild(cell);

        const plot = PlotBuilder.create<OHLC>(
          browserDeps({ createScheduler: inertScheduler }),
        )
          .setSize(WIDTH / 2, HEIGHT / 2)
          .build(cell);
        plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 5 });

        const data = candles(points, 42 + i);
        const handle = plot.mainPane.addSeries({ series: candleSeries(), data });
        let last = data[data.length - 1];
        members.push({
          plot,
          tick: (frame) => {
            last = { ...last, close: last.close * (1 + ((frame % 7) - 3) * 0.001) };
            handle.updateLast(last);
          },
        });
      }

      const [hub, second, ...rest] = members.map((m) => m.plot);
      if (hub && second) {
        syncX(hub, second, ...rest);
        syncCrosshair(hub, second, ...rest);
      }

      return { plot: members[0].plot, crosshair: crosshairLine(), handles: [] };
    },
    step: (_subject, frame) => {
      for (const member of members) member.tick(frame);
      // A hover on the hub — this puts the ghost-cursor fan-out into the frame cost too.
      members[0].plot.crosshair({ x: 40 + (frame % 500), y: 120 });
      // The harness renders only the hub — the rest are drawn here.
      for (let i = 1; i < members.length; i++) members[i].plot.render();
    },
  };
}

/** The size of one sparkline row — the same values as the sparkline guide's recipe. */
const ROW_WIDTH = 120;
const ROW_HEIGHT = 32;

/**
 * A ticker list — N sparkline rows. Every chart above is "one big chart", so
 * frame cost is bound to screen width; a list grows on instance count instead,
 * and the question is what the JS heap, the rAF fan-out and the total cold
 * start do on that axis.
 *
 * The charts are stood up exactly as the sparkline guide's recipe says
 * (createPlotDeps plus the required three, not browserDeps) — measuring
 * through the preset would fold in axis labels, the pointer and the CSS
 * reader, and stop being the list's real cost.
 *
 * The same trick as multiChartLive — the harness renders only `subject.plot`,
 * so the step draws the remaining rows itself.
 */
function sparklineList(rows: number, points: number): Scenario {
  interface Row {
    plot: Plot;
    tick: (frame: number) => void;
  }
  let list: Row[] = [];

  /**
   * Tears the previous generation down — a cold start stands this scenario up
   * many times, and without this the earlier rounds survive and the GC
   * pressure differs from round to round.
   */
  const dispose = (): void => {
    for (const row of list) row.plot.destroy();
    list = [];
  };

  return {
    name: `sparkline list · ${rows} rows × ${points} points`,
    /**
     * The previous generation is not torn down inside `build` — what
     * `measureColdStart` times is the `build` alone, so tearing down here would
     * mix destroy cost into stand-up cost. Stand-up cost is what's being
     * measured, so the harness owns dispose.
     *
     * (Plot.destroy() on this wiring is cheap enough that a teardown per
     * generation barely moves the number — the reason to fix it is the
     * contract, not the figure.)
     */
    dispose,
    build: (host, createRenderer) => {
      for (let i = 0; i < rows; i++) {
        const cell = document.createElement("div");
        cell.style.cssText = `position:absolute; width:${ROW_WIDTH}px; height:${ROW_HEIGHT}px; left:${(i % 8) * ROW_WIDTH}px; top:${Math.floor(i / 8) * ROW_HEIGHT}px;`;
        host.appendChild(cell);

        // The sparkline guide's wiring — the required three plus immediate
        // rendering; no axes, input or scheduler. The resolution observer is
        // left out too: it would add a matchMedia per row and blur the numbers.
        const plot = new Plot({
          deps: createPlotDeps({
            createLayers: (width, height) => createDomLayers(cell, width, height),
            createRenderer: createRenderer ?? createCanvasRenderer,
            createStyleReader: () => noStyle,
            createScheduler: inertScheduler,
          }),
          config: {
            showGrid: false,
            padding: { top: 2, right: 2, bottom: 2, left: 2 },
          },
          size: { width: ROW_WIDTH, height: ROW_HEIGHT },
        });

        const data = candles(points, 42 + i);
        const handle = plot.mainPane.addSeries({
          series: lineSeries({ point: { radius: 0 }, line: { width: 1.5 } }),
          data: data.map((candle) => ({ x: candle.x, y: candle.close })),
        });

        let last = { x: data[data.length - 1].x, y: data[data.length - 1].close };
        list.push({
          plot,
          tick: (frame) => {
            last = { ...last, y: last.y * (1 + ((frame % 7) - 3) * 0.001) };
            handle.updateLast(last);
          },
        });
      }

      return { plot: list[0].plot, crosshair: crosshairLine(), handles: [] };
    },
    /** A quote tick hits **every row at once** — the load a list actually takes. */
    step: (_subject, frame) => {
      for (const row of list) row.tick(frame);
      // The harness draws only the first row — the rest are drawn here.
      for (let i = 1; i < list.length; i++) list[i].plot.render();
    },
  };
}

const scenarios: Scenario[] = [
  {
    name: "hover · 100k candles",
    build: candleChart({ points: 100_000 }),
    step: hover,
  },
  {
    name: "pan · 100k candles",
    build: candleChart({ points: 100_000 }),
    step: pan,
  },
  {
    name: "zoom · 100k candles",
    build: candleChart({ points: 100_000 }),
    step: zoom,
  },
  {
    name: "prepend · 100k candles (+500/frame)",
    build: candleChart({ points: 100_000 }),
    step: prependChunk(),
  },
  {
    name: "prepend · 100k candles (bar index)",
    build: candleChart({ points: 100_000, barIndexed: true }),
    step: prependChunk(),
  },
  {
    name: "new bar · 100k candles",
    build: candleChart({ points: 100_000 }),
    step: appendTick(100_000),
  },
  {
    name: "new bar · 1k candles",
    build: candleChart({ points: 1_000 }),
    step: appendTick(1_000),
  },
  {
    name: "hover · 100k, 4 indicators",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: hover,
  },
  {
    name: "pan · 100k, 4 indicators",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: pan,
  },
  {
    name: "pan · 100k, 4 indicators, derived 2/px",
    build: candleChart({
      points: 100_000,
      indicators: 4,
      pointsPerPixel: 2,
    }),
    step: pan,
  },
  {
    name: "hover · 100k, 4 indicators, derived 2/px",
    build: candleChart({
      points: 100_000,
      indicators: 4,
      pointsPerPixel: 2,
    }),
    step: hover,
  },
  /**
   * The bar-index pair — one option apart from its siblings above. Only
   * measuring them side by side in one session separates out the coordinate
   * system's share. The combination of ticks with indicators had been an empty
   * cell all along — and it is exactly the trading screen's combination, and
   * where the bar-index mapping's rebuild lives.
   */
  {
    name: "new bar · 100k, 4 indicators (continuous x)",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: appendTick(100_000),
  },
  {
    name: "new bar · 100k, 4 indicators (bar index)",
    build: candleChart({ points: 100_000, indicators: 4, barIndexed: true }),
    step: appendTick(100_000),
  },
  {
    name: "tick update · 100k, 4 indicators (continuous x)",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: replaceTick(100_000 - 1),
  },
  {
    name: "tick update · 100k, 4 indicators (bar index)",
    build: candleChart({ points: 100_000, indicators: 4, barIndexed: true }),
    step: replaceTick(100_000 - 1),
  },
  {
    name: "hover · 100k, 4 indicators (bar index)",
    build: candleChart({ points: 100_000, indicators: 4, barIndexed: true }),
    step: hover,
  },
  {
    name: "pan · 100k, 4 indicators (bar index)",
    build: candleChart({ points: 100_000, indicators: 4, barIndexed: true }),
    step: pan,
  },
  {
    name: "drag · 100k, 4 indicators + drawings + tooltip",
    build: candleChart({ points: 100_000, indicators: 4, fullSurface: true }),
    step: dragDrawing,
  },
  {
    name: "drag · 200 drawings",
    build: candleChart({ points: 100_000, fullSurface: true, drawings: 200 }),
    step: dragDrawing,
  },
  {
    name: "hover · 100k, 4 indicators + drawings + tooltip",
    build: candleChart({ points: 100_000, indicators: 4, fullSurface: true }),
    step: hoverThroughEvents,
  },
  {
    name: "pan · 100k, 4 indicators, tiers",
    build: candleChart({ points: 100_000, indicators: 4, tiered: true }),
    step: pan,
  },
  // --- Measuring what auto-scaling costs ---
  // A pair. Either one alone means nothing.
  {
    name: "pan · 100k, 4 indicators · autoscale on",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: pan,
  },
  {
    name: "pan · 100k, 4 indicators · autoscale off",
    build: candleChart({ points: 100_000, indicators: 4, autoScale: false }),
    step: pan,
  },
  {
    name: "hover · 100k, 4 indicators · autoscale on",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: hover,
  },
  {
    name: "hover · 100k, 4 indicators · autoscale off",
    build: candleChart({ points: 100_000, indicators: 4, autoScale: false }),
    step: hover,
  },
  {
    name: "hover · 100k, 4 indicators, maxPoints=4000",
    build: candleChart({ points: 100_000, indicators: 4, maxPoints: 4_000 }),
    step: hover,
  },
  {
    name: "pan · 100k, 4 indicators, maxPoints=4000",
    build: candleChart({ points: 100_000, indicators: 4, maxPoints: 4_000 }),
    step: pan,
  },
  // --- The instance-count axis ---
  // 30 points is an ordinary sparkline; 250 is a year of daily bars. At 120px
  // wide the latter is also where decimation would first bite.
  sparklineList(50, 30),
  sparklineList(50, 250),
  sparklineList(200, 30),
];

/**
 * Two scenarios measured by alternating within one session. Absolute values
 * swing 20~25% from session to session, so they can't be a reference point —
 * alternate A and B and read only the ratio, and the environment's spread
 * lands on both sides and cancels. They alternate in blocks because thermal
 * throttling and JIT state drift over time: run one side to completion and
 * that drift shows up as the difference.
 */
interface Pair {
  /** What is being asked. Printed into the table verbatim. */
  question: string;
  baseline: Scenario;
  variant: Scenario;
}

/**
 * The tick-burst pair: an active symbol delivers more ticks between two
 * frames than the chart draws. The baseline pays `updateLast` (a full-array
 * copy plus the seam checks) per tick; `conflated` folds the burst to one
 * delivery per frame. Delivery is driven by a manual scheduler flushed
 * inside the step — this harness loop is synchronous, so the extension's
 * default rAF clock would never fire in here.
 */
function tickBurstPair(points: number, ticksPerFrame: number): Pair {
  const chart = (register: (plot: Plot, data: OHLC[]) => void): Build => {
    return (host, createRenderer) => {
      const plot = PlotBuilder.create<OHLC>(
        browserDeps({ createScheduler: inertScheduler, createRenderer }),
      )
        .setSize(WIDTH, HEIGHT)
        .build(host);
      const crosshair = crosshairLine();
      plot.addDecoration(crosshair);
      register(plot, candles(points));
      return { plot, crosshair, handles: [] };
    };
  };

  const tickOf = (previous: OHLC, frame: number): OHLC => ({
    ...previous,
    close: previous.close * (1 + ((frame % 7) - 3) * 0.001),
  });

  let raw: SeriesHandle<OHLC> | null = null;
  let rawLast: OHLC | null = null;
  let feed: ConflatedFeed<OHLC> | null = null;
  let feedFlush: (() => void) | null = null;
  let feedLast: OHLC | null = null;

  return {
    question: `A tick burst, ${points.toLocaleString("en")} points × ${ticksPerFrame}/frame: updateLast per tick against conflated`,
    baseline: {
      name: "per tick",
      build: chart((plot, data) => {
        rawLast = data[data.length - 1];
        raw = plot.mainPane.addSeries({ series: candleSeries(), data });
      }),
      step: (_subject, frame) => {
        if (!raw || !rawLast) throw new Error("build has to run first");
        let bar = rawLast;
        for (let t = 0; t < ticksPerFrame; t++) {
          bar = tickOf(bar, frame * ticksPerFrame + t);
          raw.updateLast(bar);
        }
        rawLast = bar;
      },
    },
    variant: {
      name: "conflated",
      build: chart((plot, data) => {
        feedLast = data[data.length - 1];
        const handle = plot.mainPane.addSeries({ series: candleSeries(), data });
        const manual = manualScheduler();
        feed = conflated(handle, { schedule: manual });
        feedFlush = () => manual.created[0].flush();
      }),
      step: (_subject, frame) => {
        if (!feed || !feedFlush || !feedLast) {
          throw new Error("build has to run first");
        }
        let bar = feedLast;
        for (let t = 0; t < ticksPerFrame; t++) {
          bar = tickOf(bar, frame * ticksPerFrame + t);
          feed.push(bar);
        }
        feedLast = bar;
        // The frame boundary: what a rAF tick would do in production.
        feedFlush();
      },
      dispose: () => feed?.dispose(),
    },
  };
}

/** Wraps a build so the chart starts zoomed to the trailing `fraction` of its fitted domain. */
function zoomedTo(build: Build, fraction: number): Build {
  return (host, createRenderer) => {
    const subject = build(host, createRenderer);
    const domain = subject.plot.getState().xDomain;
    if (domain) {
      subject.plot.setVisibleRange(
        domain.max - (domain.max - domain.min) * fraction,
        domain.max,
      );
    }
    subject.plot.render();
    return subject;
  };
}

const pairs: Pair[] = [
  liveTickPair(100_000),
  liveTickPair(10_000),
  // The headline case and the honesty case — the second is where conflation
  // buys nothing, which is why it stays an opt-in door and not a default.
  tickBurstPair(100_000, 50),
  tickBurstPair(10_000, 10),
  {
    /**
     * The landing cost behind infiniteHistory's page-size advice: a
     * derivation has no increment path, so every prepend recomputes it
     * wholesale — the landing pays O(held), multiplied by the derivation
     * count, not O(page). The ratio here is that multiplier.
     */
    question:
      "A history page landing, 100k candles +500/frame: candles alone against 4 SMA derivations",
    baseline: {
      name: "candles only",
      build: candleChart({ points: 100_000 }),
      step: prependChunk(),
    },
    variant: {
      name: "4 SMA derivations",
      build: candleChart({ points: 100_000, indicators: 4 }),
      step: prependChunk(),
    },
  },
  {
    /**
     * The same landing at the view infinite scroll actually happens in —
     * zoomed to a screenful. Fit-all pays an unrelated bill on top (every
     * visible point re-decimates per landing), so the pair above answers
     * "how bad can it get" and this one answers "what does the user
     * scrolling history feel" — the frame-hitch ledger row is judged on
     * this one.
     */
    question:
      "A history page landing at a 500-bar view, 100k candles +500/frame: candles alone against 4 SMA derivations",
    baseline: {
      name: "candles only (zoomed)",
      build: zoomedTo(candleChart({ points: 100_000 }), 500 / 100_000),
      step: prependChunk(),
    },
    variant: {
      name: "4 SMA derivations (zoomed)",
      build: zoomedTo(candleChart({ points: 100_000, indicators: 4 }), 500 / 100_000),
      step: prependChunk(),
    },
  },
  {
    question: "What does auto-scaling add to a pan?",
    baseline: {
      name: "off",
      build: candleChart({ points: 100_000, indicators: 4, autoScale: false }),
      step: pan,
    },
    variant: {
      name: "on",
      build: candleChart({ points: 100_000, indicators: 4 }),
      step: pan,
    },
  },
  {
    /**
     * MACD has three branches — mounted through `derive` the same EMA folds
     * three times; through a computation node it folds once. Here a candle is
     * appended every frame to force a recomputation each frame and bring that
     * difference out.
     */
    question: "MACD's three branches: three derives against one computation node",
    baseline: {
      name: "derive ×3",
      build: candleChart({ points: 100_000, macd: "derive" }),
      step: appendTick(100_000),
    },
    variant: {
      name: "computed node",
      build: candleChart({ points: 100_000, macd: "computation" }),
      step: appendTick(100_000),
    },
  },
  {
    question: "What does auto-scaling add to a hover?",
    baseline: {
      name: "off",
      build: candleChart({ points: 100_000, indicators: 4, autoScale: false }),
      step: hover,
    },
    variant: {
      name: "on",
      build: candleChart({ points: 100_000, indicators: 4 }),
      step: hover,
    },
  },
];

/**
 * The charts a cold start is measured on — no step is used, since the target
 * is everything up to the first paint. They vary by data size and indicator
 * count, the two things that decide what standing up costs.
 */
const coldStartScenarios: Scenario[] = [
  { name: "1k candles", build: candleChart({ points: 1_000 }), step: hover },
  { name: "100k candles", build: candleChart({ points: 100_000 }), step: hover },
  {
    name: "100k candles + 4 indicators",
    build: candleChart({ points: 100_000, indicators: 4 }),
    step: hover,
  },
  {
    name: "100k + MACD (derive ×3)",
    build: candleChart({ points: 100_000, macd: "derive" }),
    step: hover,
  },
  {
    name: "100k + MACD (computed node)",
    build: candleChart({ points: 100_000, macd: "computation" }),
    step: hover,
  },
  // What it costs a list to appear — the sum of standing 50 instances up. The
  // question is whether "decimation guards the frame but not the first
  // computation" also holds on the instance-count axis.
  sparklineList(50, 30),
  sparklineList(200, 30),
];

// --- Measurement ---

function withHost<T>(run: (host: HTMLElement) => T): T {
  const host = document.createElement("div");
  host.style.width = `${WIDTH}px`;
  host.style.height = `${HEIGHT}px`;
  host.style.position = "relative";
  document.getElementById("stage")!.appendChild(host);

  try {
    return run(host);
  } finally {
    host.remove();
  }
}

interface FrameResult {
  /** The point count of the commands actually emitted this frame, derived series included. */
  visiblePoints: number;
  total: Stats;
  commitShare: number;
}

function measureFrames(scenario: Scenario): FrameResult {
  const samples: number[] = [];
  let visiblePoints = 0;

  const counted = { points: 0 };

  withHost((host) => {
    const subject = scenario.build(host, countingRenderer(counted));

    for (let i = 0; i < WARMUP + ITERATIONS; i++) {
      // The step is inside the measurement too. For a scenario like a new
      // bar, the step *is* that frame's work — leave it outside and you miss
      // the whole thing you meant to measure.
      const start = performance.now();
      scenario.step(subject, i);
      subject.plot.render();
      const elapsed = performance.now() - start;

      // Throw the warmup away and keep only the last frame of the measured run.
      if (i === WARMUP - 1) counted.points = 0;
      if (i >= WARMUP) {
        samples.push(elapsed);
        visiblePoints = counted.points;
        counted.points = 0;
      }
    }

    subject.plot.destroy();
    scenario.dispose?.();
  });

  // The commit share comes from a second run through the instrumented wrapper.
  const box = { commit: 0 };
  let timedTotal = 0;

  withHost((host) => {
    const subject = scenario.build(host, timingRenderer(box));

    for (let i = 0; i < WARMUP + ITERATIONS; i++) {
      // The step is inside the measurement too. For a scenario like a new
      // bar, the step *is* that frame's work — leave it outside and you miss
      // the whole thing you meant to measure.
      const start = performance.now();
      scenario.step(subject, i);
      subject.plot.render();
      const elapsed = performance.now() - start;

      if (i === WARMUP - 1) box.commit = 0; // throw the warmup away
      if (i >= WARMUP) timedTotal += elapsed;
    }

    subject.plot.destroy();
    scenario.dispose?.();
  });

  return {
    visiblePoints,
    total: stats(samples),
    commitShare: timedTotal === 0 ? 0 : box.commit / timedTotal,
  };
}

/** One pair's result — the absolute values are kept, but the ratio is what you read. */
interface PairResult {
  question: string;
  baselineName: string;
  variantName: string;
  baselineMedian: number;
  variantMedian: number;
  /** variant / baseline. 1.0 means no difference. */
  ratio: number;
  /** The ratio per block. If they're scattered, the difference isn't worth trusting. */
  ratioRange: { min: number; max: number };
  blocks: number;
}

const PAIR_BLOCKS = 6;
const PAIR_BLOCK_FRAMES = 50;

/**
 * Runs two scenarios alternately, block by block. Both charts are stood up in
 * advance and only the frames alternate — standing them up each time would mix
 * stand-up cost in (the cold start measures that separately). Having two
 * charts alive at once puts GC pressure on differently than a solo run, but
 * both sides take it equally, so the ratio holds. That is why the absolute
 * values must not be compared against the solo tables.
 */
function measurePair(pair: Pair): PairResult {
  const hosts: HTMLElement[] = [];
  const makeHost = (): HTMLElement => {
    const host = document.createElement("div");
    host.style.width = `${WIDTH}px`;
    host.style.height = `${HEIGHT}px`;
    host.style.position = "relative";
    document.getElementById("stage")!.appendChild(host);
    hosts.push(host);
    return host;
  };

  const a = pair.baseline.build(makeHost());
  const b = pair.variant.build(makeHost());

  /** Runs one block and returns the median. */
  const block = (scenario: Scenario, subject: Subject, from: number): number => {
    const samples: number[] = [];
    for (let i = 0; i < PAIR_BLOCK_FRAMES; i++) {
      const start = performance.now();
      scenario.step(subject, from + i);
      subject.plot.render();
      samples.push(performance.now() - start);
    }
    return stats(samples).median;
  };

  // The first block is warmup and gets thrown away — the JIT isn't hot yet.
  block(pair.baseline, a, 0);
  block(pair.variant, b, 0);

  const baselineMedians: number[] = [];
  const variantMedians: number[] = [];
  const ratios: number[] = [];

  for (let i = 0; i < PAIR_BLOCKS; i++) {
    const from = (i + 1) * PAIR_BLOCK_FRAMES;

    // The order alternates too — if one side always went first, the advantage of that slot would read as the difference.
    let baseline: number;
    let variant: number;
    if (i % 2 === 0) {
      baseline = block(pair.baseline, a, from);
      variant = block(pair.variant, b, from);
    } else {
      variant = block(pair.variant, b, from);
      baseline = block(pair.baseline, a, from);
    }

    baselineMedians.push(baseline);
    variantMedians.push(variant);
    ratios.push(baseline === 0 ? 1 : variant / baseline);
  }

  a.plot.destroy();
  b.plot.destroy();
  // Both scenarios in a pair tear down every chart they made — otherwise the next pair's GC pressure differs.
  pair.baseline.dispose?.();
  pair.variant.dispose?.();
  for (const host of hosts) host.remove();

  return {
    question: pair.question,
    baselineName: pair.baseline.name,
    variantName: pair.variant.name,
    baselineMedian: stats(baselineMedians).median,
    variantMedian: stats(variantMedians).median,
    ratio: stats(ratios).median,
    ratioRange: { min: Math.min(...ratios), max: Math.max(...ratios) },
    blocks: PAIR_BLOCKS,
  };
}

/**
 * From standing the chart up to the first paint (the same definition as
 * `done` in the uPlot table). Data preparation is excluded (`candles` pulls
 * from a cache) — what's being measured is what a chart costs to stand up.
 */
function measureColdStart(scenario: Scenario, runs = 7): Stats {
  const samples: number[] = [];

  for (let i = 0; i < runs; i++) {
    withHost((host) => {
      const start = performance.now();
      const subject = scenario.build(host);
      samples.push(performance.now() - start);
      // Torn down **outside the measurement** — stand-up cost is the subject.
      subject.plot.destroy();
      scenario.dispose?.();
    });
  }

  // The first round is thrown away — neither the JIT nor the caches are warm.
  return stats(samples.slice(1));
}

/**
 * The floor of what's left in a hover frame once the layers are split apart:
 * clearing a full-size canvas and drawing two dashed lines.
 */
function measureCrosshairFloor(): { perFrameMs: number } {
  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(WIDTH * ratio);
  canvas.height = Math.round(HEIGHT * ratio);
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  document.getElementById("stage")!.appendChild(canvas);

  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  /**
   * Timed one at a time they all come out zero — `performance.now()` is
   * truncated to 100µs. Time the whole batch and divide.
   */
  const oneFrame = (i: number): void => {
    const x = 100 + (i % 900);
    const y = 80 + ((i * 7) % 400);

    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.setLineDash([3, 3]);
    context.lineWidth = 1;
    context.strokeStyle = "#94a3b8";

    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();

    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  };

  for (let i = 0; i < WARMUP; i++) oneFrame(i);

  const batch = ITERATIONS * 20;
  const start = performance.now();
  for (let i = 0; i < batch; i++) oneFrame(i);
  const elapsed = performance.now() - start;

  canvas.remove();
  return { perFrameMs: elapsed / batch };
}

/**
 * How many frames actually come out. The synchronous measurement above sees
 * only CPU time, so the interval rAF really sustains is measured separately.
 */
async function measureFrameRate(
  scenario: Scenario,
  durationMs: number,
): Promise<{ fps: number; frameInterval: Stats }> {
  const host = document.createElement("div");
  host.style.width = `${WIDTH}px`;
  host.style.height = `${HEIGHT}px`;
  host.style.position = "relative";
  document.getElementById("stage")!.appendChild(host);

  const subject = scenario.build(host);
  const intervals: number[] = [];

  await new Promise<void>((resolve) => {
    let previous = performance.now();
    const started = previous;
    let i = 0;

    const tick = (): void => {
      const now = performance.now();
      intervals.push(now - previous);
      previous = now;

      scenario.step(subject, i);
      subject.plot.render();
      i++;

      if (now - started < durationMs) requestAnimationFrame(tick);
      else resolve();
    };

    requestAnimationFrame(tick);
  });

  subject.plot.destroy();
  // Tears down the other charts this scenario stood up as well — it is called
  // with multiChartLive, so skipping this leaves three of four alive.
  scenario.dispose?.();
  host.remove();

  // The first interval is the loop's start-up delay and gets thrown away.
  const clean = intervals.slice(1);
  return {
    fps: 1000 / (clean.reduce((a, b) => a + b, 0) / clean.length),
    frameInterval: stats(clean),
  };
}

/** Leaves progress visible from outside. Needed, because the run takes a long time. */
function report(stage: string): Promise<void> {
  document.getElementById("out")!.textContent = stage;
  (window as unknown as { __stage: string }).__stage = stage;
  // Yield one frame so the screen and CDP can see this value.
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * With `?only=<substring>`, only the frame scenarios whose names match are
 * run. A full run takes ten minutes, which is far too slow to bisect a single
 * regression — a filter brings it down to twenty seconds (pairs, cold starts
 * and frame rate are skipped then).
 *
 * A filter that matches nothing throws rather than printing an empty table — a
 * quiet run of zero scenarios reads as "the regression is gone".
 */
function onlyFilter(): string | null {
  return new URLSearchParams(location.search).get("only");
}

async function main(): Promise<void> {
  const only = onlyFilter();
  if (only !== null) {
    const picked = scenarios.filter((s) => s.name.includes(only));
    if (picked.length === 0) {
      throw new Error(
        `No scenario matches ?only=${only}. Available: ${scenarios.map((s) => s.name).join(" · ")}`,
      );
    }
    const frames = [];
    for (const scenario of picked) {
      await report(`Frame: ${scenario.name}`);
      frames.push({ name: scenario.name, ...measureFrames(scenario) });
    }
    (window as unknown as { __bench: unknown }).__bench = {
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: WIDTH, height: HEIGHT },
      iterations: ITERATIONS,
      only,
      frames,
    };
    document.getElementById("out")!.textContent = JSON.stringify(
      (window as unknown as { __bench: unknown }).__bench,
      null,
      2,
    );
    document.title = "bench-done";
    return;
  }

  const results = {
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: WIDTH, height: HEIGHT },
    iterations: ITERATIONS,
    crosshairFloor: measureCrosshairFloor(),
    pairs: [] as PairResult[],
    coldStart: [] as Array<{ name: string; stats: Stats }>,
    frames: [] as Array<{ name: string } & FrameResult>,
    frameRate: [] as Array<
      { name: string; fps: number; frameInterval: Stats }
    >,
  };

  // Pairs run first — the ratios settle best when the machine is at its quietest.
  for (const pair of pairs) {
    await report(`Pair: ${pair.question}`);
    results.pairs.push(measurePair(pair));
  }

  for (const scenario of coldStartScenarios) {
    await report(`Cold start: ${scenario.name}`);
    results.coldStart.push({
      name: scenario.name,
      stats: measureColdStart(scenario),
    });
  }

  for (const scenario of scenarios) {
    await report(`Frame: ${scenario.name}`);
    results.frames.push({ name: scenario.name, ...measureFrames(scenario) });
  }

  for (const scenario of [scenarios[0], scenarios[1], scenarios[8], multiChartLive(100_000, 4)]) {
    results.frameRate.push({
      name: scenario.name,
      ...(await measureFrameRate(scenario, 1500)),
    });
  }

  (window as unknown as { __bench: unknown }).__bench = results;
  document.getElementById("out")!.textContent = JSON.stringify(results, null, 2);
  document.title = "bench-done";
}

/**
 * The window for heap sampling — the driver wraps it over CDP. `prepare` and
 * `frames` are split so that the allocation from generating the data (100k
 * candles) doesn't land inside the sampled span and bury the per-frame
 * allocation. Nothing is measured here; it only opens the span precisely.
 */
let prepared: { scenario: Scenario; subject: Subject; host: HTMLElement } | null =
  null;

const harness = {
  prepare(index: number): string {
    harness.dispose();

    const scenario = scenarios[index];
    const host = document.createElement("div");
    host.style.width = `${WIDTH}px`;
    host.style.height = `${HEIGHT}px`;
    host.style.position = "relative";
    document.getElementById("stage")!.appendChild(host);

    prepared = { scenario, subject: scenario.build(host), host };
    return scenario.name;
  },

  /** Runs the prepared scenario `frames` times. Only this span is sampled. */
  frames(count: number): void {
    if (!prepared) throw new Error("prepare() first");

    const { scenario, subject } = prepared;
    for (let i = 0; i < count; i++) {
      scenario.step(subject, i);
      subject.plot.render();
    }
  },

  /**
   * Bytes allocated per frame — the control for when the heap sampler's
   * absolute values can't be trusted. `usedJSHeapSize` is frozen within a
   * single task, so a setTimeout between frames breaks the task and the value
   * is only read at that boundary.
   *
   * Only increases are summed — a decrease means GC ran, which just moves the
   * baseline, and whatever it reclaimed is missed. So this number is a floor.
   */
  async measureAllocation(count: number): Promise<number | null> {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } })
      .memory;
    if (!prepared || !memory) return null;

    const { scenario, subject } = prepared;
    const yieldToTask = () => new Promise((resolve) => setTimeout(resolve, 0));

    await yieldToTask();
    let allocated = 0;
    let previous = memory.usedJSHeapSize;

    for (let i = 0; i < count; i++) {
      scenario.step(subject, i);
      subject.plot.render();
      await yieldToTask();

      const now = memory.usedJSHeapSize;
      if (now > previous) allocated += now - previous;
      previous = now;
    }

    return allocated / count;
  },

  /**
   * Tears down every chart the prepared scenario stood up. Back when only
   * `subject.plot` was collected, `prepare()` ran first every time and the
   * driver swept the whole scenario list, so passing a scenario that stands up
   * several left the rest behind, riding along on whatever came next.
   */
  dispose(): void {
    if (!prepared) return;

    prepared.subject.plot.destroy();
    prepared.scenario.dispose?.();
    prepared.host.remove();
    prepared = null;
  },
};

(window as unknown as { __harness: typeof harness }).__harness = harness;

(window as unknown as { __scenarios: string[] }).__scenarios = scenarios.map(
  (s) => s.name,
);

void main();
