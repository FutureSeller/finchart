/**
 * A deterministic guard on performance baselines — counts the amount of
 * work, not time. Even the same code swings 20-25% between sessions, and a
 * shared CI runner is worse than that, so a frame-time threshold either
 * misses regressions (too loose) or fires false alarms (too tight).
 * Regressions of the "don't do work you don't need to do" kind are counted
 * by call count instead — it's either 0 or 1, so it doesn't swing, and it
 * goes red the instant a regression lands.
 *
 * | Invariant | What's counted |
 * |---|---|
 * | A tick on the same bar doesn't re-index x | `rebuild` call count |
 * | Cursor scan (same spot) | ditto |
 * | Viewport cache — doesn't re-decimate when data is unchanged | `decimate` call count |
 *
 * Limit: this layer only looks at "how many times" — "how expensive is one
 * call" (things like hint lookup) is still measured by hand with
 * `bench.sh`'s paired comparison.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../data";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  DecimationStrategy,
  IndexRange,
} from "../data";
import { computation, M4Decimation, OHLCAccessor } from "../data";
import { createPlotModel } from "../plot/model";
import { candleSeries, lineSeries } from "../series";
import { barIndexX } from "../scale";
import type { Scale, XMapping } from "../scale";

/** Trading days with weekends missing — the shape bar-index coordinates are actually used in. */
const candlesOf = (count: number): OHLC[] =>
  Array.from({ length: count }, (_, i) => ({
    x: i < count / 2 ? i : i + 5,
    open: 100 + i,
    high: 104 + i,
    low: 98 + i,
    close: 102 + i,
  }));

const candles = candlesOf(40);

interface Counts {
  rebuild: number;
  decimate: number;
  /** Number of times the scan window's cursor missed and had to search from scratch again -> `XMappingProbe` */
  fallback: number;
  /** Number of times a rebuild fell back to a full walk -> `XMappingProbe.onFullRebuild` */
  fullRebuild: number;
  /** Number of scan windows opened -> `XMapping.scanToDomain` */
  scans: number;
  /** Number of draw scan windows opened -> `XMapping.scanToPixel` */
  pixelScans: number;
  /** Number of point-by-point `toPixel` (binary search) calls made outside a window — evidence of whether drawing goes through the window. */
  pixelPoints: number;
  /** Number of position-to-pixel arithmetic (`domainToPixel`) calls — evidence of whether drawing carries a position forward. */
  placePixels: number;
  /** Number of times the price registration's accessor read x — evidence of whether mapping scales with history size. */
  getX: number;
}

/**
 * Sets up a stage and counts its work. Wrapping mapping and decimation is
 * enough — both are open to being swapped out via wiring (`PlotDeps`), so
 * no instrumentation needs to be planted in production code.
 */
function counted(withIndicator: boolean, data: OHLC[] = candles) {
  const counts: Counts = {
    rebuild: 0,
    decimate: 0,
    fallback: 0,
    fullRebuild: 0,
    scans: 0,
    pixelScans: 0,
    pixelPoints: 0,
    placePixels: 0,
    getX: 0,
  };

  const createXMapping = (scale: Scale): XMapping => {
    const inner = barIndexX(scale, {
      onFallback: () => {
        counts.fallback += 1;
      },
      onFullRebuild: () => {
        counts.fullRebuild += 1;
      },
    });
    const scan = inner.scanToDomain;
    const pixelScan = inner.scanToPixel;
    const placePixel = inner.domainToPixel;
    return {
      ...inner,
      toPixel: (x) => {
        counts.pixelPoints += 1;
        return inner.toPixel(x);
      },
      domainToPixel: placePixel
        ? (value) => {
            counts.placePixels += 1;
            return placePixel(value);
          }
        : undefined,
      scanToDomain: scan
        ? () => {
            counts.scans += 1;
            return scan();
          }
        : undefined,
      scanToPixel: pixelScan
        ? () => {
            counts.pixelScans += 1;
            return pixelScan();
          }
        : undefined,
      rebuild: (sources) => {
        counts.rebuild += 1;
        inner.rebuild?.(sources);
      },
    };
  };

  const model = createPlotModel<OHLC>({
    size: { width: 800, height: 600 },
    series: { series: candleSeries(), data },
    config: { showGrid: false },
    deps: {
      createXMapping,
      createDecimation: <P extends BaseDataPoint>(
        coordinates: CoordinateAccessor<P>,
      ): DecimationStrategy<P> => {
        const inner = new M4Decimation<P>(coordinates);
        return {
          decimate: (data, range: IndexRange, threshold, screenXOf, gapFree) => {
            counts.decimate += 1;
            return inner.decimate(data, range, threshold, screenXOf, gapFree);
          },
        };
      },
    },
  });

  /**
   * A handle for changing the value. The stage's first registration
   * doesn't return a handle, so this attaches one separately. It wraps the
   * accessor to count it — a registration's `coordinates` override is the
   * injection seam, so this needs zero lines of instrumentation in
   * production code.
   */
  const ohlc = new OHLCAccessor();
  const price = model.plot.mainPane.addSeries({
    series: candleSeries(),
    data,
    coordinates: {
      getX: (point: OHLC) => {
        counts.getX += 1;
        return ohlc.getX(point);
      },
      getY: (point: OHLC) => ohlc.getY(point),
      getYRange: (point: OHLC) => ohlc.getYRange(point),
      assertFinite: (point: OHLC, index: number) =>
        ohlc.assertFinite(point, index),
      gapless: true,
    },
  });

  /**
   * An indicator is a derived registration — a tick has to go through this
   * handle to actually exercise the derived branch. Only exercising the
   * plain registration hits the identity branch, so a skip-disabling
   * regression would pass unnoticed.
   */
  const indicator = withIndicator
    ? model.plot.mainPane.addSeries({
        series: lineSeries(),
        data,
        derive: (source: DataView<OHLC>): LineDataPoint[] =>
          source.map((c) => ({ x: c.x, y: c.close })),
      })
    : null;

  model.plot.render();

  return { model, counts, price, indicator };
}

/** A tick on the bar in progress — a new value at the same x. This is 99% of a real feed. */
const sameBarTick = (close: number): OHLC => ({
  ...candles[candles.length - 1],
  close,
});

describe("a tick on the same bar does not re-index x", () => {
  /**
   * A tick only sets a new value at the same x, so the bar index stays put
   * — but there used to be code that unconditionally gathered every
   * series's x values and re-indexed them whenever `change.data` fired.
   * That waste once ate up half the frame.
   */
  it("is zero on a stage with only candles", () => {
    const { model, counts, price } = counted(false);
    const before = counts.rebuild;

    price.updateLast(sameBarTick(150));
    model.plot.render();

    expect(counts.rebuild - before).toBe(0);
  });

  /** Stays zero even with a derived series attached — the derived branch used to always answer "don't know" as true, so having even a single indicator disabled the skip entirely. */
  it("is zero even when ticking the derived indicator directly", () => {
    const { model, counts, indicator } = counted(true);
    expect(indicator).not.toBeNull();
    const before = counts.rebuild;

    indicator?.updateLast(sameBarTick(150));
    model.plot.render();

    expect(counts.rebuild - before).toBe(0);
  });

  /** A new bar really does add a new x — re-indexing here is correct. If this were 0, the index would go stale. */
  it("re-indexes on a new bar — but not with a full walk", () => {
    const { model, counts, price } = counted(false);
    const before = counts.rebuild;
    counts.fullRebuild = 0;

    price.updateLast({ ...candles[candles.length - 1], x: 999 });
    model.plot.render();

    expect(counts.rebuild - before).toBeGreaterThan(0);
    /**
     * The rebuild running is correct (x really did grow), but a full walk
     * (an O(N) merge) must be 0 — the entry's xs cache grows in place, so
     * its identity signals only the tail changed.
     */
    expect(counts.fullRebuild).toBe(0);
  });

  it("setData is correct to take a full walk — a lower bound", () => {
    const { model, counts, price } = counted(false);
    counts.fullRebuild = 0;

    price.setData(candlesOf(50));
    model.plot.render();

    // A swapped-out dataset — if a fast path swallows this, a stale index gets drawn.
    expect(counts.fullRebuild).toBeGreaterThan(0);
  });
});

describe("the data path does not run when only the viewed position changes", () => {
  /**
   * pan/zoom only moves the domain — the index is derived from the data,
   * so it has no reason to change. If this breaks, a pan re-indexes every
   * series's x on every frame.
   */
  it("panning does not re-index x", () => {
    const { model, counts } = counted(true);
    const before = counts.rebuild;

    for (let i = 0; i < 5; i++) {
      model.plot.panByPixels(10);
      model.plot.render();
    }

    expect(counts.rebuild - before).toBe(0);
  });

  /**
   * When neither the viewport nor the data has changed, the previous
   * decimation result is reused as-is — this is the case when the
   * crosshair moves or a decoration updates (`SimpleDataManager`'s cache).
   */
  it("redrawing the same frame does not re-decimate", () => {
    const { model, counts } = counted(true);
    const before = counts.decimate;

    model.plot.render();
    model.plot.render();

    expect(counts.decimate - before).toBe(0);
  });
});

describe("a scan window opens, and the cursor lives inside the window", () => {
  /**
   * The cursor belongs to the mapping, not the window — `toDomain` is pure,
   * and the cursor is owned by whatever window `scanToDomain` opened. The
   * guard splits into two:
   *
   * - Lower bound — does a window even open? This goes to 0 if the wiring,
   *   or `scanToDomain` on the mapping itself, disappears — it guards
   *   against reverting the optimization wholesale and having the counter
   *   silently vanish along with it, passing by accident.
   * - Upper bound — does the cursor live inside the window? Fallbacks per
   *   window should be constant (the shape of M4, which measures both ends
   *   of a range first). If it scales with the window's point count, the
   *   scan is dead.
   */
  it("decimation opens a window on a bar-index stage", () => {
    const many = candlesOf(20_000);
    const { model, counts } = counted(true, many);
    counts.scans = 0;

    model.plot.panByPixels(30);
    model.plot.render();

    // At least one scan window per series — 0 means the wiring or scanToDomain has disappeared.
    expect(counts.scans).toBeGreaterThan(0);
  });

  it("drawing opens a window — not a binary search per point", () => {
    const many = candlesOf(20_000);
    const { model, counts } = counted(true, many);
    counts.pixelScans = 0;
    counts.pixelPoints = 0;

    model.plot.render();

    // Lower bound — at least one draw window per registration (candles,
    // indicator). 0 means the pane never opened the door, or `scanToPixel`
    // has disappeared from the mapping.
    expect(counts.pixelScans).toBeGreaterThanOrEqual(2);
    // Upper bound — once drawing goes through a window, point-by-point
    // `toPixel` (binary search) is left only to a handful of decorations.
    // If drawing ignores the window, this piles up to the number of points
    // drawn (hundreds) and goes red immediately.
    expect(counts.pixelPoints).toBeLessThan(50);
  });

  it("drawing carries decimation's positions forward — it does not search the mapping again", () => {
    const many = candlesOf(20_000);
    const { model, counts } = counted(true, many);
    counts.placePixels = 0;
    counts.pixelPoints = 0;

    model.plot.render();

    // Lower bound — one position-arithmetic call per point drawn. 0 means
    // the manager isn't carrying positions forward, or the series never
    // went through the `screenXAt` door.
    expect(counts.placePixels).toBeGreaterThan(100);
    // Upper bound — point-by-point `toPixel` (binary search over the merged
    // list) should be left only to a handful of decorations.
    expect(counts.pixelPoints).toBeLessThan(50);
  });

  it("fallbacks inside a window scale with the window count — not the point count", () => {
    const many = candlesOf(20_000);
    const { model, counts } = counted(true, many);
    counts.scans = 0;
    counts.fallback = 0;

    model.plot.panByPixels(30);
    model.plot.render();

    /**
     * A handful of fallbacks per window (M4 measures both ends of a range
     * first) is normal. It's a regression if this value tracks the number
     * of points drawn instead of the number of windows.
     */
    expect(counts.scans).toBeGreaterThan(0);
    expect(counts.fallback).toBeLessThan(counts.scans * 8);

    /**
     * The window count itself also needs an upper bound — a ratio check
     * alone (`fallback < scans×8`) would pass a regression where decimation
     * opens a window per point, since numerator and denominator would
     * inflate together. There is one window per scan (series x range):
     * with three series and no gaps, that's single digits; per point, it's
     * in the tens of thousands.
     */
    expect(counts.scans).toBeLessThan(50);
  });
});

describe("a new bar does not re-map the whole history", () => {
  /**
   * Because `xValues`'s cache key is array identity, a single new bar used
   * to miss and re-map the entire history. Now an identity registration
   * only extends the tail (the discipline of "whoever knows about the
   * change pays only for that much"). Drawing (the visible ~3,200 points)
   * is the baseline, so this isn't 0 — what's being checked is whether the
   * term proportional to history size (20,000) has dropped out.
   *
   * Drives this in real feed order — several ticks on the same bar, then a
   * new bar. If a replacement tick doesn't chain the mapping cache's key
   * (`xsOf`) onto the new array, the next new bar's increment falls back
   * to a miss and re-mapping comes back.
   */
  it("getX does not scale with history even for a new bar after several ticks", () => {
    const many = candlesOf(20_000);
    const { model, counts, price } = counted(false, many);
    const last = many[many.length - 1];

    for (const close of [110, 120, 130]) {
      price.updateLast({ ...last, close });
      model.plot.render();
    }
    counts.getX = 0;

    price.updateLast({ ...last, x: last.x + 1 });
    model.plot.render();

    // If re-mapping is still alive, the full history of 20,000 gets added.
    expect(counts.getX).toBeLessThan(10_000);
  });
});

describe("a computation node's tick does not get cut off downstream", () => {
  /**
   * Even if a node's `calcLast` folds a tick down to just its tail, the
   * gain gets cut off downstream if the input registration that draws that
   * branch goes through a full `pull -> setData` reload. The registration
   * accessor's getX call count measures exactly that — the full path's
   * validation-plus-re-mapping scales with history, while the tail path is
   * a handful of calls. Draw/decimation getX noise is zeroed out by
   * injecting a strategy that draws nothing.
   */
  it("getX does not scale with history for a tick on an input registration", () => {
    const model = createPlotModel<OHLC>({
      size: { width: 800, height: 600 },
      series: { series: candleSeries(), data: candlesOf(1_000) },
      config: { showGrid: false },
    });
    const data = candlesOf(1_000);
    const price = model.plot.mainPane.addSeries({
      series: candleSeries(),
      data,
    });

    const node = computation({
      inputs: [price],
      calc: (input) => ({
        doubled: input.map((c) => ({ x: c.x, y: (c as OHLC).close * 2 })),
      }),
      calcLast: (previous, [input], [change]) => {
        if (change.kind === "none") return previous;
        const count = change.count;
        const keep =
          previous.doubled.length - (change.kind === "replace" ? count : 0);
        return {
          doubled: previous.doubled.slice(0, keep).concat(
            input
              .slice(input.length - count)
              .map((c) => ({ x: c.x, y: (c as OHLC).close * 2 })),
          ),
        };
      },
    });

    let getX = 0;
    model.plot.mainPane.addSeries({
      series: lineSeries(),
      input: node.out.doubled,
      coordinates: {
        getX: (point: { x: number }) => {
          getX += 1;
          return point.x;
        },
        getY: (point: { x: number; y: number | null }) => point.y,
      },
      // Draws nothing — leaves this registration's getX counting only the data path.
      decimation: { strategy: { decimate: () => [] } },
    });
    model.plot.render();
    getX = 0;

    price.updateLast({ ...data[data.length - 1], close: 999 });
    model.plot.render();

    // If this had taken the full path, validation plus re-mapping would put it at >= 2,000.
    expect(getX).toBeLessThan(50);
  });
});
