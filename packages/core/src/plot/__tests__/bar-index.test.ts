import { describe, expect, it } from "vitest";
import { axisLabelsSpy, filledRects } from "../../__tests__/dom-fakes";
import type { OHLC } from "../../data";
import { barIndexX } from "../../scale";
import { timeTicks } from "../../axis";
import { candleSeries } from "../../series";
import { testBrowserDeps, testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
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
  const { deps, xScale, yScale } = testBrowserDepsWithScales({
    createXMapping: barIndexX,
    createAxisLabels: labels.createAxisLabels,
  });
  const { plot, handle, layers } = mountPlot({
    deps,
    series: candleSeries(),
    data: candles,
    config: { ...defaultConfig, showGrid: false },
  });

  return { plot, handle, xScale, yScale, layers, labels };
}

/** Center x of each candle body, left to right. */
function bodyCenters(layers: ReturnType<typeof mounted>["layers"]): number[] {
  return filledRects(layers.context)
    .map((rect) => rect.x + rect.width / 2)
    .sort((a, b) => a - b);
}

describe("bar-index mapping", () => {
  it("should fit the domain in index space", () => {
    const { xScale } = mounted();

    // Five candles -> index 0~4 (not the data x range 0~6), half a bar past each end.
    expect(xScale.getDomain()).toEqual([-0.5, 4.5]);
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
    const { plot, handle, xScale } = mounted();
    plot.pan(-1);
    const viewing = xScale.getDomain();

    handle.prepend([-3, -2, -1].map(candleAt));

    // Existing bars keep their index (the extension goes negative), so the
    // domain is unchanged — meaning the visible window is unchanged too.
    expect(xScale.getDomain()).toEqual(viewing);
  });

  it("should keep prepended bars reachable by panning", () => {
    const { plot, handle, xScale, layers } = mounted();
    handle.prepend([-3, -2, -1].map(candleAt));

    // The new bars sit at index -3~-1.
    xScale.setDomain(-3, -1);
    plot.render();

    // The three prepended bars sit inside the plot; the next bar (index 0)
    // is drawn past the right edge too, where the clip hides it.
    const right = plot.mainPane.area.right;
    const centers = bodyCenters(layers);
    expect(centers.filter((center) => center <= right)).toHaveLength(3);
    expect(centers).toHaveLength(4);
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

    // The domain is index [-0.5,4.5], but subscribers hear it in x — the same
    // unit as dataRange, half an edge gap past each end.
    expect(seen).toEqual({ startX: -0.5, endX: 6.5 });
  });

  it("should speak data x in crosshair", () => {
    const { plot, xScale } = mounted();
    plot.render();

    let seen: number | null = null;
    plot.on("crosshair", (payload) => {
      seen = payload === null ? null : payload.x;
    });

    // The pixel where the candle at index 3 (x=5) sits. Axis slices shift the
    // range, so ask the scale instead of hardcoding the pixel.
    plot.crosshair({ x: xScale.scale(3), y: 300 });

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
    const { plot, xScale, labels } = mounted();
    // Only two candles are visible — if the automatic spacing drops to 0.5,
    // a tick lands between bars (interpolated x).
    xScale.setDomain(2, 3);
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

  /**
   * **Bars are not spread evenly over the window the strategy is asked
   * about.** A single day holding ninety bars, followed by nine days
   * holding one each, is almost the whole index and almost none of the
   * elapsed time — so calendar boundaries days apart snap onto
   * neighbouring bars a few pixels from each other. The requested spacing
   * is a promise about the drawing, so it has to be met again after the
   * snap, in pixels.
   */
  it("should not let snapped ticks crowd each other", () => {
    const DAY_MS = 24 * 3600 * 1000;
    const EPOCH = Date.UTC(2026, 0, 1);
    const packed = Array.from({ length: 91 }, (_, i) => candleAt(i / 91));
    const daily = Array.from({ length: 9 }, (_, i) => candleAt(2 + i));
    const { plot, labels } = mounted([...packed, ...daily]);
    plot.applyOptions({
      axis: {
        x: {
          minTickSpacing: 100,
          ticks: timeTicks({
            timeZone: "UTC",
            locale: "en",
            epochOf: (days) => EPOCH + days * DAY_MS,
            xOfEpoch: (msValue) => (msValue - EPOCH) / DAY_MS,
          }),
        },
      },
    });
    // The window this layout was measured on — the data edge to edge.
    plot.setVisibleRange(0, 10);
    plot.render();

    const positions = labels.input().x.map((tick) => tick.position);
    expect(positions.length).toBeGreaterThan(1);
    for (let i = 1; i < positions.length; i++) {
      expect(Math.abs(positions[i] - positions[i - 1])).toBeGreaterThanOrEqual(100);
    }
  });
});

/**
 * **A calendar boundary is chosen by what it stands for, before it is
 * labelled.** The strategy used to label its boundaries first, and the
 * frame then snapped them onto bars and thinned them by pixel — so where
 * two landed on one bar the closer won, and where two crowded the earlier
 * won, and neither rule knew that one of the pair was the month's name.
 */
describe("bar-index ticks keep the promoted label", () => {
  const DAY_MS = 24 * 3600 * 1000;

  /**
   * February 2026 opens on a Sunday. Saturday's, Sunday's and Monday's
   * midnights all snap onto Monday's bar, and Monday's own midnight stands
   * closest — so "2/2" used to win the bar over "Feb".
   */
  it("keeps the month's name on the first bar after a weekend 1st", () => {
    const EPOCH = Date.UTC(2026, 0, 26); // Monday
    // Mon–Fri twice, with the weekend of the 31st and the 1st between.
    const tradingDays = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
    const { plot, labels } = mounted(tradingDays.map(candleAt));
    plot.applyOptions({
      axis: {
        x: {
          // Close enough for the day rung, wide enough that nothing crowds.
          minTickSpacing: 40,
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

    expect(labels.xTexts()).toEqual([
      "1/26", "1/27", "1/28", "1/29", "1/30",
      "Feb", "2/3", "2/4", "2/5", "2/6",
    ]);
  });

  /**
   * Ninety-one bars inside the 30th of January and one a day after that:
   * the 31st and the 1st are neighbouring bars a few pixels apart, so the
   * pair crowds and the earlier used to be kept — "1/31" over "Feb".
   */
  it("keeps the month's name when it crowds the day before it", () => {
    const EPOCH = Date.UTC(2026, 0, 30); // Friday
    const packed = Array.from({ length: 91 }, (_, i) => candleAt(i / 91));
    const daily = Array.from({ length: 9 }, (_, i) => candleAt(1 + i));
    const { plot, labels } = mounted([...packed, ...daily]);
    plot.applyOptions({
      axis: {
        x: {
          minTickSpacing: 60,
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

    // The month's name takes the bar; the days either side of it, all a
    // few pixels away, give way to it rather than the other way round.
    expect(labels.xTexts()).toEqual(["1/30", "Feb"]);
  });

  /**
   * **Where the clock landed exactly on a grid reading, the tick is the
   * reading, not the landing.** New York's clock skips 02:00 and comes
   * to rest on 03:00, which a quarter-hour grid stands on too. A landing
   * gives way to a real boundary when the two crowd — but this one *is*
   * the boundary, and must not give way to the 04:00 beside it.
   */
  it("keeps a landing that is itself a boundary over the tick after it", () => {
    const HOUR_MS = 3600 * 1000;
    const EPOCH = Date.UTC(2026, 2, 8, 5); // 00:00 EST, the day the clock moves
    // A hundred bars inside 01:00–02:00 EST, then one an hour: 03:00, 04:00,
    // 05:00 EDT — so the last three are neighbouring bars a few pixels apart.
    const packed = Array.from({ length: 100 }, (_, i) => candleAt(1 + i / 100));
    const hourly = [2, 3, 4].map(candleAt);
    const { plot, labels } = mounted([...packed, ...hourly]);
    plot.applyOptions({
      axis: {
        x: {
          minTickSpacing: 60,
          ticks: timeTicks({
            timeZone: "America/New_York",
            locale: "en-US",
            epochOf: (hours) => EPOCH + hours * HOUR_MS,
            xOfEpoch: (ms) => (ms - EPOCH) / HOUR_MS,
          }),
        },
      },
    });
    // The window this layout was measured on — the data edge to edge.
    plot.setVisibleRange(1, 4);
    plot.render();

    expect(labels.xTexts()).toEqual(["01:00", "01:15", "01:30", "01:45", "03:00"]);
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
    const { plot, handle, xScale } = mounted();
    plot.fitDomains();
    expect(xScale.getDomain()).toEqual([-0.5, 4.5]);

    handle.updateLast(candleAt(9));
    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([-0.5, 5.5]);
  });

  it("a new bar actually gets drawn", () => {
    const { plot, handle, layers } = mounted();
    handle.updateLast(candleAt(9));
    plot.fitDomains();
    plot.render();

    const centers = bodyCenters(layers);
    expect(centers).toHaveLength(TRADING_DAYS.length + 1);
    // The new bar is the next index — one pitch past the last, not drawn at
    // its data x (9) or stacked on a stale slot.
    const pitch = centers[1]! - centers[0]!;
    const steps = centers.slice(1).map((c, i) => c - centers[i]!);
    for (const step of steps) expect(step).toBeCloseTo(pitch, 6);
    plot.destroy();
  });

  /** A tick that replaces the same x — only the value changes, so the index must stay put. */
  it("a tick on the same bar does not disturb the index", () => {
    const { plot, handle, xScale, layers } = mounted();

    handle.updateLast({ ...candleAt(6), close: 130, high: 140 });
    plot.fitDomains();
    plot.render();

    expect(xScale.getDomain()).toEqual([-0.5, 4.5]);
    expect(bodyCenters(layers)).toHaveLength(TRADING_DAYS.length);
  });

  /** Order matters: a new bar after several ticks — if a skipped rebuild also skips the next one, the new bar never makes it into the index. */
  it("a new bar after several ticks still makes it in", () => {
    const { plot, handle, xScale } = mounted();

    for (const close of [110, 120, 130]) {
      handle.updateLast({ ...candleAt(6), close });
    }
    handle.updateLast(candleAt(9));
    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([-0.5, 5.5]);
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
