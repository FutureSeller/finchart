import { describe, expect, it } from "vitest";
import { axisLabelsSpy, filledRects } from "../../__tests__/dom-fakes";
import type { OHLC } from "../../data";
import { barIndexX } from "../../scale";
import { timeTicks } from "../../axis";
import { candleSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/** x's for a trading week with a gap between Fri and Mon. Neighbors in bar index. */
const TRADING_DAYS = [0, 1, 2, 5, 6];

const candleAt = (x: number): OHLC => ({
  x,
  open: 100,
  high: 104,
  low: 98,
  close: 102,
});

const gappedWeek = TRADING_DAYS.map(candleAt);

function mounted(candles: OHLC[] = gappedWeek) {
  const labels = axisLabelsSpy();
  const deps = testBrowserDeps({
    createXMapping: barIndexX,
    createAxisLabels: labels.createAxisLabels,
  });
  const { plot, handle, layers } = mountPlot({
    deps,
    series: candleSeries(),
    data: candles,
    config: { ...defaultConfig, showGrid: false },
  });

  return { plot, handle, deps, layers, labels };
}

/** Center x of each candle body, left to right. */
function bodyCenters(layers: ReturnType<typeof mounted>["layers"]): number[] {
  return filledRects(layers.context)
    .map((rect) => rect.x + rect.width / 2)
    .sort((a, b) => a - b);
}

describe("bar-index mapping", () => {
  it("should fit the domain in index space", () => {
    const { deps } = mounted();

    // Five candles -> index 0~4, not the data x range (0~6).
    expect(deps.xScale.getDomain()).toEqual([0, 4]);
  });

  it("should render gapped candles at a uniform pitch", () => {
    const { plot, layers } = mounted();
    plot.render();

    const centers = bodyCenters(layers);
    expect(centers).toHaveLength(TRADING_DAYS.length);

    // The weekend (2->5) does not open up on screen — every neighbor gap is equal.
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 6);
    }
  });

  it("should leave the weekend gap visible without the mapping", () => {
    const deps = testBrowserDeps();
    const { plot, layers } = mountPlot({
      deps,
      series: candleSeries(),
      data: gappedWeek,
      config: { ...defaultConfig, showGrid: false },
    });
    plot.render();

    // Control: under the continuous mapping, the 2->5 gap is three times a neighbor gap.
    const centers = bodyCenters(layers);
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    expect(Math.max(...gaps)).toBeCloseTo(Math.min(...gaps) * 3, 6);
  });

  it("should keep the visible window when older bars are prepended", () => {
    const { plot, handle, deps } = mounted();
    plot.pan(-1);
    const viewing = deps.xScale.getDomain();

    handle.prepend([-3, -2, -1].map(candleAt));

    // Existing bars keep their index (the extension goes negative), so the
    // domain is unchanged — meaning the visible window is unchanged too.
    expect(deps.xScale.getDomain()).toEqual(viewing);
  });

  it("should keep prepended bars reachable by panning", () => {
    const { plot, handle, deps, layers } = mounted();
    handle.prepend([-3, -2, -1].map(candleAt));

    // The new bars sit at index -3~-1.
    deps.xScale.setDomain(-3, -1);
    plot.render();

    expect(bodyCenters(layers)).toHaveLength(3);
  });

  it("should speak data x in xDomainChange", () => {
    const { plot, handle } = mounted();

    // No event fires if the domain already equals the refit result — move the window first.
    plot.pan(-1);

    let seen: { startX: number; endX: number } | null = null;
    plot.on("xDomainChange", ({ startX, endX }) => {
      seen = { startX, endX };
    });

    handle.setData(gappedWeek);

    // The domain is index [0,4], but subscribers hear it in x — the same unit as dataRange.
    expect(seen).toEqual({ startX: 0, endX: 6 });
  });

  it("should speak data x in crosshair", () => {
    const { plot, deps } = mounted();
    plot.render();

    let seen: number | null = null;
    plot.on("crosshair", ({ x }) => {
      seen = x;
    });

    // The pixel where the candle at index 3 (x=5) sits. Axis slices shift the
    // range, so ask the scale instead of hardcoding the pixel.
    plot.crosshair({ x: deps.xScale.scale(3), y: 300 });

    expect(seen).toBeCloseTo(5, 6);
  });
});

/**
 * Whether decimation buckets by screen slot — in bar-index coordinates too,
 * screenXScan decides whether a column is a slot on screen.
 */
describe("decimation bucketing", () => {
  interface Seen {
    screenXScan?: () => (x: number) => number;
    called: boolean;
  }

  /** A strategy that just records the third argument and passes data through. */
  function spyingStrategy(seen: Seen) {
    return {
      decimate: (
        data: OHLC[],
        range: { start: number; end: number },
        _threshold: number,
        screenXScan?: () => (x: number) => number,
      ) => {
        seen.called = true;
        seen.screenXScan = screenXScan;
        return data.slice(range.start, range.end);
      },
    };
  }

  function drawnWith(createXMapping?: typeof barIndexX): Seen {
    const seen: Seen = { called: false };
    const deps = testBrowserDeps({ createXMapping });
    const { plot } = mountPlot({ deps, config: defaultConfig });

    plot.mainPane.addSeries({
      series: candleSeries(),
      data: gappedWeek,
      decimation: { strategy: spyingStrategy(seen) },
    });
    plot.render();

    expect(seen.called).toBe(true);
    return seen;
  }

  it("should hand the screen place to the strategy in bar-index mode", () => {
    const seen = drawnWith(barIndexX);

    // A candle's screen place is its index — x=5, after skipping the
    // weekend, lands in the third slot (3). Ask the pane, since the
    // cursor belongs to it and the answer matches `toDomain`.
    expect(seen.screenXScan?.()(5)).toBe(3);
  });

  it("should keep the viewport bare in continuous mode", () => {
    const seen = drawnWith(undefined);

    // In continuous mode x already is the screen place, so it isn't even loaded.
    expect(seen.screenXScan).toBeUndefined();
  });
});

/**
 * Whether axis labels recover x from the index — the domain is bar index,
 * but what the user reads must be time.
 */
describe("axis labels", () => {
  // Assert against the input the core hands the renderer (AxisLabelsInput.x),
  // not the label implementation (DOM/canvas) — the core owns the content.
  type Mounted = ReturnType<typeof mounted>;
  const xLabels = (labels: Mounted["labels"]): string[] => labels.xTexts();

  it("should label ticks with the data x, not the index", () => {
    const { plot, labels } = mounted();
    plot.render();

    // Five ticks over domain [0,4] — the labels are exactly the trading
    // days, weekend skipped.
    expect(xLabels(labels)).toEqual(["0", "1", "2", "5", "6"]);
  });

  it("should run the user format on the data x", () => {
    const { plot, labels } = mounted();
    plot.applyOptions({ axis: { x: { format: (x) => `day ${x}` } } });
    plot.render();

    expect(xLabels(labels)).toContain("day 5");
  });

  it("should not put ticks between bars when zoomed in", () => {
    const { plot, deps, labels } = mounted();
    // Only two candles are visible — if the automatic spacing drops to 0.5,
    // a tick lands between bars (interpolated x).
    deps.xScale.setDomain(2, 3);
    plot.render();

    // Spacing never drops below 1. Labels are only real bar x's.
    expect(xLabels(labels)).toEqual(["2", "5"]);
  });

  /**
   * Calendar ticks (timeTicks) must honor the same contract — so that ticks
   * for dates with no candle don't pile up and overlap in a single gap,
   * each snaps onto the boundary day or the first bar after it, and when
   * several land on the same bar only the one closest to the boundary
   * survives.
   */
  it("should snap calendar ticks onto bars, dropping weekend ghosts", () => {
    // x = days since 2026-01-07 (Wed). Trading days [0,1,2,5,6] = Wed Thu
    // Fri, Mon Tue — Sat (3) and Sun (4) have no candle.
    const DAY_MS = 24 * 3600 * 1000;
    const EPOCH = Date.UTC(2026, 0, 7);
    const { plot, labels } = mounted();
    plot.applyOptions({
      axis: {
        x: {
          ticks: timeTicks({
            timeZone: "UTC",
            locale: "en",
            epochOf: (days) => EPOCH + days * DAY_MS,
            xOfEpoch: (ms) => (ms - EPOCH) / DAY_MS,
          }),
        },
      },
    });
    plot.render();

    // No ghost ticks for Sat (1/10) or Sun (1/11). The Monday bar's label —
    // even though Saturday and Sunday midnight both snap to it and compete —
    // is Monday midnight (1/12).
    expect(xLabels(labels)).toEqual(["1/7", "1/8", "1/9", "1/12", "1/13"]);
  });
});

/**
 * The index is derived from the data, so it must never go stale first.
 * "Skip the rebuild if x hasn't moved" saves work on reindex, but a new bar
 * must always be counted.
 */
describe("ticks never leave the index stale", () => {
  /**
   * Ask the index, not the domain — updateLast's contract is to leave the
   * domain untouched, so whether a rebuild ran is only visible through
   * fitDomains().
   */
  it("a new bar makes it into the index", () => {
    const { plot, handle, deps } = mounted();
    plot.fitDomains();
    expect(deps.xScale.getDomain()).toEqual([0, 4]);

    handle.updateLast(candleAt(9));
    plot.fitDomains();

    expect(deps.xScale.getDomain()).toEqual([0, 5]);
  });

  it("a new bar actually gets drawn", () => {
    const { plot, handle, layers } = mounted();
    handle.updateLast(candleAt(9));
    plot.fitDomains();
    plot.render();

    expect(bodyCenters(layers)).toHaveLength(TRADING_DAYS.length + 1);
  });

  /** A tick that replaces the same x — only the value changes, so the index must stay put. */
  it("a tick on the same bar does not disturb the index", () => {
    const { plot, handle, deps, layers } = mounted();

    handle.updateLast({ ...candleAt(6), close: 130, high: 140 });
    plot.fitDomains();
    plot.render();

    expect(deps.xScale.getDomain()).toEqual([0, 4]);
    expect(bodyCenters(layers)).toHaveLength(TRADING_DAYS.length);
  });

  /** Order matters: a new bar after several ticks — if a skipped rebuild also skips the next one, the new bar never makes it into the index. */
  it("a new bar after several ticks still makes it in", () => {
    const { plot, handle, deps } = mounted();

    for (const close of [110, 120, 130]) {
      handle.updateLast({ ...candleAt(6), close });
    }
    handle.updateLast(candleAt(9));
    plot.fitDomains();

    expect(deps.xScale.getDomain()).toEqual([0, 5]);
  });
});

/**
 * A derived series can shift x — if toPoints drops points based on values
 * (conditional markers, etc.), the set of x's it draws changes. So the
 * derived branch is left "unknown" and always recounted.
 */

/**
 * A derived series is judged by its output — build a discriminating test by
 * diffing toPoints' result against the previous one.
 */
