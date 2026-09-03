/**
 * `infiniteHistory` — the past-loading door.
 *
 * Contract: watching the visible x range, it asks the consumer's `fetch`
 * for older points when the screen nears (prefetch) or passes (gap fill)
 * the left edge of what's loaded, delivers each page to a sink, owns the
 * cursor, and defends it — trimming inclusive boundaries, refusing pages
 * that ignore the cursor, and shutting down on permanently wrong fetches.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { OHLCAccessor } from "../../data";
import { ContractError, DataError } from "../../primitives";
import { lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { infiniteHistory, type HistoryStatus } from "../infinite-history";

const points = (from: number, to: number): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x < to; x++) out.push({ x, y: 1 });
  return out;
};

/** A real headless plot showing x 100..119 — events, pixels, and state are the live ones. */
function chart(data = points(100, 120)) {
  const model = createPlotModel({ size: { width: 800, height: 600 }, series: null });
  const handle = model.plot.mainPane.addSeries({ series: lineSeries(), data });
  return { plot: model.plot, handle };
}

/** Serves queued pages in order; records every `before` it was asked for. */
function servedFetch(...pages: (LineDataPoint[] | Error)[]) {
  const calls: number[] = [];
  return {
    calls,
    fetch: (before: number): Promise<LineDataPoint[]> => {
      calls.push(before);
      const next = pages.shift();
      if (next === undefined) return Promise.resolve([]);
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
}

/** A fetch whose resolution the test controls — for in-flight assertions. */
function heldFetch() {
  const calls: number[] = [];
  const pending: ((page: LineDataPoint[]) => void)[] = [];
  return {
    calls,
    fetch: (before: number): Promise<LineDataPoint[]> => {
      calls.push(before);
      return new Promise((resolve) => pending.push(resolve));
    },
    land(page: LineDataPoint[]) {
      const resolve = pending.shift();
      if (!resolve) throw new Error("no fetch in flight");
      resolve(page);
    },
  };
}

function recordingSink() {
  const pages: LineDataPoint[][] = [];
  return { pages, sink: (page: LineDataPoint[]) => void pages.push(page) };
}

/** Lets a whole landing chain (fetch → deliver → re-judge → fetch …) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Captures the loader's out-of-band rethrows instead of crashing the test. */
function muteRethrow() {
  const captured: unknown[] = [];
  vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => {
    try {
      task();
    } catch (error) {
      captured.push(error);
    }
  });
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("infiniteHistory", () => {
  it("without coordinates the loader judges x order only — a bar page has no y and still lands", async () => {
    const { plot } = chart();
    const bar = (x: number): OHLC => ({ x, open: 1, high: 2, low: 0.5, close: 1.5 });
    const pages: OHLC[][] = [];
    const loader = infiniteHistory<OHLC>(
      plot,
      (page) => void pages.push(page),
      () => (pages.length === 0 ? [bar(80), bar(90)] : []),
      { from: 100 },
    );

    plot.setVisibleRange(90, 110);
    await settle();
    expect(pages).toEqual([[bar(80), bar(90)]]);
    expect(loader.status()).not.toBe("terminated");
  });

  it("trims before judging — a repeated boundary bar at or after the cursor is discarded, not fatal", async () => {
    const { plot } = chart();
    const bar = (x: number): OHLC => ({ x, open: 1, high: 2, low: 0.5, close: 1.5 });
    const pages: OHLC[][] = [];
    const loader = infiniteHistory<OHLC>(
      plot,
      (page) => void pages.push(page),
      () => (pages.length === 0 ? [bar(90), bar(95), bar(100), bar(100)] : []),
      { from: 100, coordinates: new OHLCAccessor() },
    );

    plot.setVisibleRange(90, 110);
    await settle();
    expect(pages).toEqual([[bar(90), bar(95)]]);
    expect(loader.status()).not.toBe("terminated");
  });

  it("a page repeating an x on bars is a fetch defect — terminated, never delivered, never retried", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const bar = (x: number): OHLC => ({ x, open: 1, high: 2, low: 0.5, close: 1.5 });
    const calls: number[] = [];
    const pages: OHLC[][] = [];
    const loader = infiniteHistory<OHLC>(
      plot,
      (page) => void pages.push(page),
      (before) => {
        calls.push(before);
        return [bar(90), bar(90), bar(95)];
      },
      { from: 100, coordinates: new OHLCAccessor() },
    );

    plot.setVisibleRange(90, 110);
    await settle();
    expect(loader.status()).toBe("terminated");
    expect(pages).toEqual([]);
    expect(captured[0]).toBeInstanceOf(DataError);
    expect(captured[0]).toMatchObject({ message: expect.stringContaining("one point per x") });

    plot.setVisibleRange(85, 105);
    await settle();
    expect(calls).toEqual([100]);
  });

  it("trims and advances in the accessor's x — the space the chart orders by", async () => {
    interface Timed extends LineDataPoint {
      t: number;
    }
    const byT = {
      getX: (point: Timed) => point.t,
      getY: (point: Timed) => point.y,
    };
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: null });
    const held: Timed[] = [
      { x: 5, t: 100, y: 1 },
      { x: 6, t: 110, y: 1 },
    ];
    model.plot.mainPane.addSeries({ series: lineSeries(), data: held, coordinates: byT });
    const calls: number[] = [];
    const pages: Timed[][] = [];
    // Ascending in t, and t is what the cursor speaks — raw x is unrelated.
    const page: Timed[] = [
      { x: 900, t: 80, y: 1 },
      { x: 1, t: 90, y: 1 },
      { x: 2, t: 100, y: 1 },
    ];
    const loader = infiniteHistory<Timed>(
      model.plot,
      (older) => void pages.push(older),
      (before) => {
        calls.push(before);
        return calls.length === 1 ? page : [];
      },
      { from: 100, coordinates: byT },
    );

    model.plot.setVisibleRange(90, 120);
    await settle();
    expect(calls[0]).toBe(100);
    // Trimmed by t (the point at t=100 sits on the cursor), delivered in order.
    expect(pages[0]?.map((point) => point.t)).toEqual([80, 90]);
    // The next cursor is the accessor x of the oldest landed point.
    model.plot.setVisibleRange(60, 90);
    await settle();
    expect(calls[1]).toBe(80);
    expect(["idle", "done"]).toContain(loader.status());
  });

  it("guard 1: a gap (screen past the data) fetches and delivers to the sink", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch(points(80, 100));
    const { pages, sink } = recordingSink();
    infiniteHistory(plot, sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([100]);
    expect(pages).toEqual([points(80, 100)]);
  });

  it("guard 2: prefetch fires only on a left move inside the threshold", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch(points(80, 100));
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    // Rightward into the threshold zone — not the past-seeking gesture.
    plot.setVisibleRange(103, 118);
    await settle();
    expect(calls).toEqual([]);

    // Now a left move with slack (2 units) under one screen (15 units).
    plot.setVisibleRange(102, 117);
    await settle();
    expect(calls).toEqual([100]);
  });

  it("guard 3: setData's refit event (zero slack, no left move) does not fire", async () => {
    const { plot, handle } = chart();
    const { calls, fetch } = servedFetch(points(80, 100));
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    handle.setData(points(100, 140)); // refits — reports startX right at the data edge
    await settle();

    expect(calls).toEqual([]);
  });

  it("guard 4: events during an in-flight fetch do not stack requests", async () => {
    const { plot } = chart();
    const { calls, fetch, land } = heldFetch();
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    plot.setVisibleRange(85, 105);
    plot.setVisibleRange(82, 102);
    expect(calls).toEqual([100]);

    land(points(80, 100));
    await settle();
    expect(calls).toEqual([100]); // landing covered the gap — nothing more to pull
  });

  it("guard 5 + 14: a landing that still leaves a gap chains without events, cursor strictly receding", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch(points(80, 100), points(60, 80), points(40, 60));
    const { pages, sink } = recordingSink();
    infiniteHistory(plot, sink, fetch, { from: 100 });

    // Deep past — the wall state where pan stops emitting events entirely.
    plot.setVisibleRange(50, 70);
    await settle();

    expect(calls).toEqual([100, 80, 60]); // no event in between, strictly decreasing
    expect(pages.length).toBe(3);
  });

  it("guard 6: an empty page means the end of history — done, and no more fetches", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch([]);
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();
    expect(loader.status()).toBe("done");

    plot.setVisibleRange(85, 105);
    await settle();
    expect(calls).toEqual([100]);
  });

  it("guard 7: a rejected fetch is transient — loading recovers, the next gesture retries", async () => {
    muteRethrow();
    const { plot } = chart();
    const { calls, fetch } = servedFetch(new Error("network"), points(80, 100));
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();
    expect(loader.status()).toBe("idle");

    plot.setVisibleRange(89, 109);
    await settle();
    expect(calls).toEqual([100, 100]);
  });

  it("guard 8: an inclusive-boundary page is trimmed quietly and the cursor advances", async () => {
    const { plot, handle } = chart();
    // The page carries the boundary bar x=100 — the Binance/Upbit shape.
    const { calls, fetch } = servedFetch(points(80, 101), points(60, 80));
    infiniteHistory(plot, (page) => handle.prepend(page), fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();

    // Undefended, the duplicate x=100 slips through prepend's seam check
    // silently (equal x is allowed); the trim is what keeps it out.
    const xs = handle.read().map((point) => point.x);
    expect(xs.filter((x) => x === 100)).toEqual([100]);
    expect(xs[0]).toBe(80);

    // The cursor advanced to 80 — a deeper gesture asks from there, not 100.
    plot.setVisibleRange(70, 90);
    await settle();
    expect(calls).toEqual([100, 80]);
  });

  it("guard 9: a page trimmed to nothing throws instead of reading as the end", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const { fetch } = servedFetch([
      { x: 100, y: 1 },
      { x: 105, y: 1 },
    ]);
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(loader.status()).toBe("idle"); // not done — the end and a cursor-ignoring fetch differ
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeInstanceOf(DataError);
    expect(String(captured[0])).toContain("100");
  });

  it("guard 10: an out-of-order page terminates the loader for good", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const { calls, fetch } = servedFetch(
      [
        { x: 99, y: 1 },
        { x: 95, y: 1 },
      ],
      points(80, 100),
    );
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();
    expect(loader.status()).toBe("terminated");
    expect(captured[0]).toBeInstanceOf(DataError);

    plot.setVisibleRange(85, 105);
    await settle();
    expect(calls).toEqual([100]); // no retry — the fetch's shape is wrong, not the network
  });

  it("guard 11: a throwing sink still releases loading", async () => {
    muteRethrow();
    const { plot } = chart();
    const { fetch } = servedFetch(points(80, 100));
    const loader = infiniteHistory(
      plot,
      () => {
        throw new Error("consumer bug");
      },
      fetch,
      { from: 100 },
    );

    plot.setVisibleRange(90, 110);
    await settle();

    expect(loader.status()).toBe("idle");
  });

  it("guard 12: a landing after dispose is dropped", async () => {
    const { plot } = chart();
    const { fetch, land } = heldFetch();
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(plot, sink, fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    loader.dispose();
    land(points(80, 100));
    await settle();

    expect(pages).toEqual([]);
  });

  it("guard 13: a hand-made sink (a closure over plain state) fits as-is", async () => {
    const { plot } = chart();
    const { fetch } = servedFetch(points(80, 100));
    let state = points(100, 120);
    infiniteHistory(plot, (older) => (state = [...older, ...state]), fetch, { from: 100 });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(state.map((point) => point.x)).toEqual(points(80, 120).map((point) => point.x));
  });

  it("guard 15: status transitions arrive as a snapshot + subscription pair", async () => {
    const { plot } = chart();
    const { fetch } = servedFetch(points(80, 100), []);
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });
    const seen: HistoryStatus[] = [];
    loader.statusChanges.subscribe((status) => void seen.push(status));

    expect(loader.status()).toBe("idle");
    plot.setVisibleRange(90, 110);
    expect(loader.status()).toBe("loading");
    await settle();
    plot.setVisibleRange(75, 95);
    await settle();

    expect(seen).toEqual(["loading", "idle", "loading", "done"]);
    expect(loader.status()).toBe("done");
  });

  it("judges at install from getState — a restored view already past the data starts filling", async () => {
    const { plot } = chart();
    plot.setVisibleRange(90, 110); // the view was restored before the loader existed
    const { calls, fetch } = servedFetch(points(80, 100));
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    await settle();
    expect(calls).toEqual([100]);
  });

  it("dispose unsubscribes and is idempotent", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch(points(80, 100));
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });

    loader.dispose();
    loader.dispose();
    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([]);
  });
});

/**
 * Chokepoint 8 (boundary registry) — the two numeric slots are the door's
 * own to refuse: `from` seeds every `before` the fetch is asked for, and
 * `screensAhead` scales the pull threshold. A NaN here would poison every
 * later pixel comparison silently.
 */
describe("chokepoint 8 — the cursor seed and the threshold", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "should refuse from=%s at the door",
    (from) => {
      const { plot } = chart();
      expect(() =>
        infiniteHistory(plot, recordingSink().sink, servedFetch().fetch, { from }),
      ).toThrow(ContractError);
    },
  );

  it.each([0, -1, Number.NaN])("should refuse screensAhead=%s at the door", (screensAhead) => {
    const { plot } = chart();
    expect(() =>
      infiniteHistory(plot, recordingSink().sink, servedFetch().fetch, {
        from: 100,
        screensAhead,
      }),
    ).toThrow(ContractError);
  });
});
