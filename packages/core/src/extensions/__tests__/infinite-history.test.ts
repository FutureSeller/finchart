/**
 * `infiniteHistory` — the past-loading door.
 *
 * Contract: watching the visible x range, it asks the consumer's `fetch`
 * for older points when the screen nears (prefetch) or passes (gap fill)
 * the left edge of what's loaded, delivers each page to a sink, owns the
 * cursor, and defends it — trimming inclusive boundaries, refusing pages
 * that ignore the cursor, and shutting down on permanently wrong fetches.
 */
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { OHLCAccessor } from "../../data";
import { ContractError, DataError } from "../../primitives";
import { histogramSeries, lineSeries, type Series } from "../../series";
import { createPlotModel } from "../../plot/model";
import { infiniteHistory, type HistoryStatus, type InfiniteHistoryHost } from "../infinite-history";

const points = (from: number, to: number): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x < to; x++) out.push({ x, y: 1 });
  return out;
};

/** A real headless plot showing x 100..119 — events, pixels, and state are the live ones. */
function chart(data = points(100, 120), series: Series<LineDataPoint> = lineSeries()) {
  const model = createPlotModel({ size: { width: 800, height: 600 }, series: null });
  const handle = model.plot.mainPane.addSeries({ series, data });
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

  it("a plain fit's half-bar margin is not a gap — no fetch at install, on fitDomains, or on a refill", async () => {
    // Columns draw a bar body, so their fit carries the margin.
    const { plot, handle } = chart(points(100, 120), histogramSeries());
    const { calls, fetch } = servedFetch(points(80, 100));
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });
    // The fit shows half a bar of blank before the first point.
    expect(plot.getVisibleRange()?.min).toBe(99.5);

    plot.fitDomains();
    handle.setData(points(100, 140));
    await settle();

    expect(calls).toEqual([]);
  });

  it("more than half a bar of blank before the data is a gap", async () => {
    const { plot } = chart();
    const { calls, fetch } = servedFetch(points(80, 100));
    // Judged at install, with no move at all — only the gap fill can fire.
    plot.setVisibleRange(99.4, 119.4);
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });
    await settle();

    expect(calls).toEqual([100]);
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

  it("judges at install from getVisibleRange — a view already past the data starts filling", async () => {
    const { plot } = chart();
    plot.setVisibleRange(90, 110); // the view was set before the loader existed
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

/** The plot as the loader's host, counting the subscriptions the loader holds open. */
function countingHost(plot: ReturnType<typeof chart>["plot"]) {
  const live = { count: 0 };
  const host: InfiniteHistoryHost = {
    on(event, handler) {
      const off = plot.on(event, handler);
      live.count += 1;
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        live.count -= 1;
        off();
      };
    },
    pixelAtX: (x: number) => plot.pixelAtX(x),
    xAt: (px: number) => plot.xAt(px),
    getVisibleRange: () => plot.getVisibleRange(),
    leadingMargin: () => plot.leadingMargin(),
  };
  return { host, live };
}

describe("infiniteHistory — a loader that stops", () => {
  it("a handle detached while its page is in flight stops the loader — no throw, stopped, unsubscribed, no more fetches", async () => {
    const captured = muteRethrow();
    const { plot, handle } = chart();
    const { host, live } = countingHost(plot);
    const { calls, fetch, land } = heldFetch();
    const loader = infiniteHistory(host, handle, fetch, { from: 100 });
    const seen: HistoryStatus[] = [];
    loader.statusChanges.subscribe((status) => void seen.push(status));

    plot.setVisibleRange(90, 110);
    expect(loader.status()).toBe("loading");
    handle.dispose();
    land(points(80, 100));
    await settle();

    expect(captured).toEqual([]);
    expect(loader.status()).toBe("stopped");
    expect(seen).toEqual(["loading", "stopped"]);
    expect(live.count).toBe(0);
    plot.setVisibleRange(70, 90);
    await settle();
    expect(calls).toEqual([100]);
  });

  it("a handle detached before the next fetch stops the loader instead of fetching", async () => {
    const { plot, handle } = chart();
    // A second registration keeps the chart laid out once the loader's own handle is gone.
    plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 120) });
    const { host, live } = countingHost(plot);
    const { calls, fetch } = servedFetch(points(80, 100));
    const loader = infiniteHistory(host, handle, fetch, { from: 100 });

    handle.dispose();
    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([]);
    expect(loader.status()).toBe("stopped");
    expect(live.count).toBe(0);
  });

  it("a live handle takes pages like a sink does — and the cursor moves to the landed page", async () => {
    const { plot, handle } = chart();
    const { calls, fetch } = servedFetch(points(90, 100), points(80, 90));
    infiniteHistory(plot, handle, fetch, { from: 100 });

    plot.setVisibleRange(80, 110); // a gap two pages deep
    await settle();

    expect(calls.slice(0, 2)).toEqual([100, 90]);
    expect(handle.read().map((point) => point.x)).toEqual(points(80, 120).map((point) => point.x));
  });

  it("dispose while a page is in flight reads as stopped, once, and the late page is dropped", async () => {
    const { plot } = chart();
    const { host, live } = countingHost(plot);
    const { fetch, land } = heldFetch();
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(host, sink, fetch, { from: 100 });
    const seen: HistoryStatus[] = [];
    loader.statusChanges.subscribe((status) => void seen.push(status));

    plot.setVisibleRange(90, 110);
    loader.dispose();
    loader.dispose();
    land(points(80, 100));
    await settle();

    expect(loader.status()).toBe("stopped");
    expect(seen).toEqual(["loading", "stopped"]);
    expect(pages).toEqual([]);
    expect(live.count).toBe(0);
  });

  it("dispose after the end keeps the reason it ended — done stays done, terminated stays terminated", async () => {
    muteRethrow();
    const { plot } = chart();
    const first = countingHost(plot);
    const done = infiniteHistory(first.host, recordingSink().sink, servedFetch([]).fetch, { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();
    expect(done.status()).toBe("done");
    done.dispose();
    expect(done.status()).toBe("done");
    expect(first.live.count).toBe(0);

    const second = chart();
    const secondHost = countingHost(second.plot);
    const broken = infiniteHistory(secondHost.host, recordingSink().sink, servedFetch([{ x: 90, y: 1 }, { x: 80, y: 1 }]).fetch, { from: 100 });
    second.plot.setVisibleRange(90, 110);
    await settle();
    expect(broken.status()).toBe("terminated");
    broken.dispose();
    expect(broken.status()).toBe("terminated");
    expect(secondHost.live.count).toBe(0);
  });

  it("a loading listener that disposes stops the fetch it was about to start", async () => {
    const { plot } = chart();
    const { host, live } = countingHost(plot);
    const { calls, fetch } = servedFetch(points(80, 100));
    const loader = infiniteHistory(host, recordingSink().sink, fetch, { from: 100 });
    loader.statusChanges.subscribe((status) => {
      if (status === "loading") loader.dispose();
    });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([]);
    expect(loader.status()).toBe("stopped");
    expect(live.count).toBe(0);
  });

  it("a sink that disposes — returning or throwing — leaves the loader stopped", async () => {
    const captured = muteRethrow();
    for (const throws of [false, true]) {
      const { plot } = chart();
      const { calls, fetch } = servedFetch(points(80, 90), points(70, 80));
      let loader: ReturnType<typeof infiniteHistory> | null = null;
      loader = infiniteHistory(
        plot,
        () => {
          loader?.dispose();
          if (throws) throw new Error("sink after dispose");
        },
        fetch,
        { from: 100 },
      );

      plot.setVisibleRange(60, 110); // a gap that would otherwise chain
      await settle();

      expect(loader.status()).toBe("stopped");
      expect(calls).toEqual([100]);
    }
    expect(captured.length).toBe(1);
  });

  it("a synchronous fetch that disposes — returning, throwing or rejecting — leaves the loader stopped with nothing unhandled", async () => {
    const captured = muteRethrow();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const endings: ("return" | "throw" | "reject")[] = ["return", "throw", "reject"];
      for (const ending of endings) {
        const { plot } = chart();
        const { host, live } = countingHost(plot);
        let loader: ReturnType<typeof infiniteHistory> | null = null;
        loader = infiniteHistory(
          host,
          recordingSink().sink,
          () => {
            loader?.dispose();
            if (ending === "throw") throw new Error("fetch after dispose");
            if (ending === "reject") return Promise.reject(new Error("rejected after dispose"));
            return points(80, 100);
          },
          { from: 100 },
        );
        plot.setVisibleRange(90, 110);
        await settle();
        expect(loader.status()).toBe("stopped");
        expect(live.count).toBe(0);
      }
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(captured.length).toBe(1);
  });

  it("a listener that disposes mid-notification: the next listener never hears the stale loading", async () => {
    const { plot } = chart();
    const { fetch } = heldFetch();
    const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });
    const a: HistoryStatus[] = [];
    const b: HistoryStatus[] = [];
    loader.statusChanges.subscribe((status) => {
      a.push(status);
      if (status === "loading") loader.dispose();
    });
    loader.statusChanges.subscribe((status) => void b.push(status));

    plot.setVisibleRange(90, 110);
    await settle();

    expect(a).toEqual(["loading", "stopped"]);
    expect(b).toEqual(["stopped", "stopped"]);
  });

  it("every notification carries the state current at delivery — through a nested there-and-back transition", async () => {
    muteRethrow();
    const { plot } = chart();
    let call = 0;
    const loader = infiniteHistory(
      plot,
      recordingSink().sink,
      (before) => {
        call += 1;
        if (call === 1) return Promise.resolve(points(95, before));
        throw new Error("the second request fails on the spot");
      },
      { from: 100 },
    );
    const mismatches: string[] = [];
    const heard = { a: 0, b: 0 };
    let nudged = false;
    loader.statusChanges.subscribe((status) => {
      heard.a += 1;
      if (status !== loader.status()) mismatches.push(`a heard ${status}, status was ${loader.status()}`);
      // On the first idle, pull the view past the data again — the nested request fails synchronously.
      if (status === "idle" && !nudged) {
        nudged = true;
        plot.setVisibleRange(60, 100);
      }
    });
    loader.statusChanges.subscribe((status) => {
      heard.b += 1;
      if (status !== loader.status()) mismatches.push(`b heard ${status}, status was ${loader.status()}`);
    });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(call).toBeGreaterThanOrEqual(2);
    expect(mismatches).toEqual([]);
    // Nothing is suppressed: every change reaches both listeners.
    expect(heard.b).toBe(heard.a);
  });

  it("a snapshot reader is never left behind — a listener that reads the snapshot and then restarts a fetch", async () => {
    const { plot } = chart();
    let call = 0;
    const pending: ((page: LineDataPoint[]) => void)[] = [];
    const loader = infiniteHistory(
      plot,
      recordingSink().sink,
      (before) => {
        call += 1;
        if (call === 1) return Promise.resolve(points(95, before));
        return new Promise((resolve) => pending.push(resolve));
      },
      { from: 100 },
    );
    // A store in the useSyncExternalStore shape: a notification invalidates, the render reads status().
    let rendered = loader.status();
    let restarted = false;
    loader.statusChanges.subscribe((status) => {
      if (status === "idle" && !restarted) {
        restarted = true;
        rendered = loader.status(); // a synchronous render of the second subscriber, forced from here
        plot.setVisibleRange(60, 100); // …and another fetch starts
      }
    });
    let lastDelivered: HistoryStatus | null = null;
    loader.statusChanges.subscribe((status) => {
      lastDelivered = status;
      rendered = loader.status();
    });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(loader.status()).toBe("loading");
    expect(rendered).toBe(loader.status());
    expect(lastDelivered).toBe(loader.status());
  });

  it("a handle whose attached reading throws stops the loader and surfaces the error — before a fetch and at a landing", async () => {
    for (const when of ["before fetch", "at landing"]) {
      const captured = muteRethrow();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const { plot, handle } = chart();
        const { host, live } = countingHost(plot);
        const held = heldFetch();
        const { calls, land } = held;
        let fetched = false;
        const fetch = (before: number) => {
          fetched = true;
          return held.fetch(before);
        };
        const broken = new Error("attached failed");
        const sink = {
          prepend: (page: LineDataPoint[]) => handle.prepend(page),
          get attached(): boolean {
            // "at landing": fine until the request is out, broken from then on.
            if (when === "before fetch" || fetched) throw broken;
            return true;
          },
        };
        const loader = infiniteHistory(host, sink, fetch, { from: 100 });
        plot.setVisibleRange(90, 110);
        if (when === "at landing") land(points(80, 100));
        await settle();

        expect(loader.status()).toBe("stopped");
        expect(live.count).toBe(0);
        expect(captured).toEqual([broken]);
        expect(calls.length).toBe(when === "before fetch" ? 0 : 1);
        expect(handle.read()[0]?.x).toBe(100);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    }
  });

  it("an accessor that disposes the loader — returning or throwing — stops the landing it is part of", async () => {
    for (const throws of [false, true]) {
      const captured = muteRethrow();
      const { plot } = chart();
      const { pages, sink } = recordingSink();
      let loader: ReturnType<typeof infiniteHistory> | null = null;
      const coordinates = {
        getX: (point: LineDataPoint) => {
          loader?.dispose();
          if (throws) throw new Error("accessor after dispose");
          return point.x;
        },
        getY: (point: LineDataPoint) => point.y,
      };
      loader = infiniteHistory(plot, sink, servedFetch(points(80, 100)).fetch, { from: 100, coordinates });
      plot.setVisibleRange(90, 110);
      await settle();

      expect(loader.status()).toBe("stopped");
      expect(pages).toEqual([]);
      expect(captured.length).toBe(throws ? 1 : 0);
    }
  });

  it("an accessor that disposes while the page is being checked — returning or throwing — delivers nothing and stays stopped", async () => {
    for (const throws of [false, true]) {
      muteRethrow();
      const { plot } = chart();
      const { pages, sink } = recordingSink();
      let loader: ReturnType<typeof infiniteHistory> | null = null;
      // getX is left alone; getY runs when the retained page is scanned.
      const coordinates = {
        getX: (point: LineDataPoint) => point.x,
        getY: (point: LineDataPoint) => {
          loader?.dispose();
          if (throws) throw new Error("getY after dispose");
          return point.y;
        },
      };
      loader = infiniteHistory(plot, sink, servedFetch(points(80, 100)).fetch, { from: 100, coordinates });
      plot.setVisibleRange(90, 110);
      await settle();

      expect(loader.status()).toBe("stopped");
      expect(pages).toEqual([]);
    }
  });

  it("an accessor that disposes the handle while the page is being checked stops the loader before delivery", async () => {
    const captured = muteRethrow();
    const { plot, handle } = chart();
    // A second registration keeps the chart laid out once the loader's handle is gone.
    plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 120) });
    const { host, live } = countingHost(plot);
    const coordinates = {
      getX: (point: LineDataPoint) => point.x,
      getY: (point: LineDataPoint) => {
        if (handle.attached) handle.dispose();
        return point.y;
      },
    };
    const loader = infiniteHistory(host, handle, servedFetch(points(80, 100)).fetch, { from: 100, coordinates });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(captured).toEqual([]);
    expect(loader.status()).toBe("stopped");
    expect(live.count).toBe(0);
  });

  it("no accessor read follows delivery — a sink-triggered dispose seen by a later read cannot overwrite stopped", async () => {
    for (const throws of [false, true]) {
      const captured = muteRethrow();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const { plot } = chart();
        let delivered = false;
        let loader: ReturnType<typeof infiniteHistory> | null = null;
        const coordinates = {
          getX: (point: LineDataPoint) => {
            if (delivered) {
              loader?.dispose();
              if (throws) throw new Error("getX after delivery");
            }
            return point.x;
          },
          getY: (point: LineDataPoint) => point.y,
        };
        loader = infiniteHistory(
          plot,
          () => {
            delivered = true;
          },
          servedFetch(points(95, 100)).fetch,
          { from: 100, coordinates },
        );
        plot.setVisibleRange(99, 110);
        await settle();

        // The page landed and nothing read the accessor afterwards, so the loader is simply idle.
        expect(loader.status()).toBe("idle");
        expect(captured).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    }
  });

  it("a handle's prepend is looked up once, when the loader is made, and called on the handle", async () => {
    const { plot, handle } = chart();
    let lookups = 0;
    const receivers: unknown[] = [];
    const sink = {
      get attached(): boolean {
        return handle.attached;
      },
      get prepend() {
        lookups += 1;
        return function (this: unknown, page: LineDataPoint[]) {
          receivers.push(this);
          handle.prepend(page);
        };
      },
    };
    infiniteHistory(plot, sink, servedFetch(points(90, 100), points(80, 90)).fetch, { from: 100 });
    plot.setVisibleRange(80, 110); // two pages land
    await settle();

    expect(lookups).toBe(1);
    expect(receivers).toEqual([sink, sink]);
    expect(handle.read()[0]?.x).toBe(80);
  });

  it("delivery calls the handle's prepend without reading anything off it — a call getter never runs", async () => {
    const { plot, handle } = chart();
    let callReads = 0;
    const prepend = (page: LineDataPoint[]) => handle.prepend(page);
    Object.defineProperty(prepend, "call", {
      get() {
        callReads += 1;
        return Function.prototype.call;
      },
    });
    const sink = { attached: true, prepend };
    infiniteHistory(plot, sink, servedFetch(points(80, 100)).fetch, { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(callReads).toBe(0);
    expect(handle.read()[0]?.x).toBe(80);
  });

  it("a status listener that throws does not wedge the loader — the request still goes out, the chain still fills, the error surfaces", async () => {
    const captured = muteRethrow();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { plot } = chart();
      const { calls, fetch } = servedFetch(points(90, 100), points(80, 90));
      const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100 });
      const boom = new Error("listener failed");
      loader.statusChanges.subscribe(() => {
        throw boom;
      });
      plot.setVisibleRange(80, 110); // a gap two pages deep
      await settle();

      expect(calls.slice(0, 2)).toEqual([100, 90]);
      expect(captured.filter((error) => error === boom).length).toBeGreaterThan(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("a loading listener that disposes the handle stops the loader before the fetch", async () => {
    const { plot, handle } = chart();
    plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 120) });
    const { host, live } = countingHost(plot);
    const { calls, fetch } = heldFetch();
    const loader = infiniteHistory(host, handle, fetch, { from: 100 });
    loader.statusChanges.subscribe((status) => {
      if (status === "loading" && handle.attached) handle.dispose();
    });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([]);
    expect(loader.status()).toBe("stopped");
    expect(live.count).toBe(0);
  });

  it("a host that reports the view while subscribing, with the handle already gone, is unsubscribed all the same", () => {
    const { plot, handle } = chart();
    plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 120) });
    handle.dispose();
    const { host: counted, live } = countingHost(plot);
    const host: InfiniteHistoryHost = {
      ...counted,
      on(event, handler) {
        const off = counted.on(event, handler);
        // Report the current view synchronously, the way an eager host might.
        plot.setVisibleRange(90, 110);
        return off;
      },
    };
    const loader = infiniteHistory(host, handle, heldFetch().fetch, { from: 100 });

    expect(loader.status()).toBe("stopped");
    expect(live.count).toBe(0);
  });

  it("a host whose getVisibleRange throws at install unwinds the subscription and throws", () => {
    const { plot } = chart();
    const { host: counted, live } = countingHost(plot);
    const host: InfiniteHistoryHost = {
      ...counted,
      getVisibleRange: () => {
        throw new Error("view unavailable");
      },
    };
    expect(() => infiniteHistory(host, recordingSink().sink, heldFetch().fetch, { from: 100 })).toThrow("view unavailable");
    expect(live.count).toBe(0);
  });

  it("an unsubscribe that throws still leaves the loader stopped and surfaces the error", () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const boom = new Error("unsubscribe failed");
    const host: InfiniteHistoryHost = {
      on: (event, handler) => {
        const off = plot.on(event, handler);
        return () => {
          off();
          throw boom;
        };
      },
      pixelAtX: (x) => plot.pixelAtX(x),
      xAt: (px) => plot.xAt(px),
      getVisibleRange: () => plot.getVisibleRange(),
      leadingMargin: () => plot.leadingMargin(),
    };
    const loader = infiniteHistory(host, recordingSink().sink, heldFetch().fetch, { from: 100 });
    loader.dispose();

    expect(loader.status()).toBe("stopped");
    expect(captured).toEqual([boom]);
  });

  it("a fetch that resolves to something other than an array terminates the loader instead of wedging it", async () => {
    for (const page of [undefined, null, { bars: [] }]) {
      const captured = muteRethrow();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const { plot } = chart();
        // The shape a `() => response.json()` fetch can hand back — not an array.
        const loader = infiniteHistory(
          plot,
          recordingSink().sink,
          // @ts-expect-error — a page that is not an array is exactly what this guards
          () => Promise.resolve(page),
          { from: 100 },
        );
        plot.setVisibleRange(90, 110);
        await settle();

        expect(loader.status()).toBe("terminated");
        expect(captured.length).toBe(1);
        expect(captured[0]).toBeInstanceOf(DataError);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    }
  });

  it("a returned native promise is observed without reading its own then — a throwing getter is never run and the page lands", async () => {
    const { plot } = chart();
    const { pages, sink } = recordingSink();
    let thenReads = 0;
    const loader = infiniteHistory(
      plot,
      sink,
      () => {
        const promise = Promise.resolve(points(90, 100));
        // oxlint-disable-next-line unicorn/no-thenable -- the thenable is the input under test
        Object.defineProperty(promise, "then", {
          get() {
            thenReads += 1;
            throw new Error("then unavailable");
          },
        });
        return promise;
      },
      { from: 100 },
    );
    plot.setVisibleRange(90, 110);
    await settle();

    expect(thenReads).toBe(0);
    expect(pages.length).toBe(1);
    expect(loader.status()).not.toBe("loading");
  });

  it("a thenable whose then throws recovers like a failed fetch — the error surfaces, the next gesture retries", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const broken = new Error("then unavailable");
    let call = 0;
    const loader = infiniteHistory(
      plot,
      recordingSink().sink,
      // @ts-expect-error — a thenable that is not a promise, the shape a hand-rolled client can return
      () => {
        call += 1;
        if (call === 1) {
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- the thenable is the input under test
            get then() {
              throw broken;
            },
          };
        }
        return Promise.resolve(points(90, 100));
      },
      { from: 100 },
    );
    plot.setVisibleRange(90, 110);
    await settle();

    expect(captured).toContain(broken);
    expect(loader.status()).toBe("idle");
    plot.setVisibleRange(85, 105); // the next gesture
    await settle();
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("a returned promise with an unreadable then that rejects — at once or later — is still observed, never unhandled", async () => {
    for (const timing of ["rejected", "pending then rejected"]) {
      const captured = muteRethrow();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const { plot } = chart();
        const failure = new Error("the request failed");
        let rejectLater: (error: unknown) => void = () => undefined;
        const loader = infiniteHistory(
          plot,
          recordingSink().sink,
          () => {
            const promise =
              timing === "rejected"
                ? Promise.reject(failure)
                : new Promise<LineDataPoint[]>((_, reject) => {
                    rejectLater = reject;
                  });
            // oxlint-disable-next-line unicorn/no-thenable -- the thenable is the input under test
            Object.defineProperty(promise, "then", {
              get() {
                throw new Error("then unavailable");
              },
            });
            return promise;
          },
          { from: 100 },
        );
        plot.setVisibleRange(90, 110);
        if (timing !== "rejected") rejectLater(failure);
        await settle();
        await settle();

        expect(captured).toContain(failure);
        expect(loader.status()).toBe("idle");
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    }
  });

  it("a page whose own reads dispose the loader — an array proxy — leaves it stopped, not done", async () => {
    const { plot } = chart();
    let loader: ReturnType<typeof infiniteHistory> | null = null;
    const empty: LineDataPoint[] = [];
    const page = new Proxy(empty, {
      get(target, key, receiver) {
        if (key === "length") loader?.dispose();
        return Reflect.get(target, key, receiver);
      },
    });
    loader = infiniteHistory(plot, recordingSink().sink, () => Promise.resolve(page), { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(loader.status()).toBe("stopped");
  });

  it("a page is copied without consulting its constructor — a species hook on the page is never read", async () => {
    const { plot } = chart();
    let constructorReads = 0;
    const page: LineDataPoint[] = [];
    Object.defineProperty(page, "constructor", {
      get() {
        constructorReads += 1;
        return Array;
      },
    });
    const loader = infiniteHistory(plot, recordingSink().sink, () => Promise.resolve(page), { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(constructorReads).toBe(0);
    expect(loader.status()).toBe("done");
  });

  it("an eager host whose first callback fails keeps its unsubscribe — the failure surfaces out of band", () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const { host: counted, live } = countingHost(plot);
    const broken = new Error("pixels unavailable");
    let eager = true;
    const host: InfiniteHistoryHost = {
      ...counted,
      on(event, handler) {
        const off = counted.on(event, handler);
        // Report the view inside `on`, before the unsubscribe is handed over — the judgment needs pixels.
        plot.setVisibleRange(90, 110);
        eager = false;
        return off;
      },
      pixelAtX: (x) => {
        if (eager) throw broken;
        return plot.pixelAtX(x);
      },
    };
    const loader = infiniteHistory(host, recordingSink().sink, heldFetch().fetch, { from: 100 });

    expect(captured).toContain(broken);
    loader.dispose();
    expect(live.count).toBe(0);
  });

  it("a returned promise whose constructor cannot be read still leaves the loader recoverable", async () => {
    const captured = muteRethrow();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { plot } = chart();
      const blocked = new Error("constructor unavailable");
      let call = 0;
      const loader = infiniteHistory(
        plot,
        recordingSink().sink,
        () => {
          call += 1;
          const promise = Promise.resolve(points(90, 100));
          if (call === 1) {
            Object.defineProperty(promise, "constructor", {
              get() {
                throw blocked;
              },
            });
          }
          return promise;
        },
        { from: 100 },
      );
      plot.setVisibleRange(90, 110);
      await settle();

      expect(captured).toContain(blocked);
      expect(loader.status()).toBe("idle");
      plot.setVisibleRange(85, 105); // the next gesture
      await settle();
      expect(call).toBeGreaterThanOrEqual(2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    // A fulfilled promise: nothing to leave unhandled. A rejecting one with this getter is unobservable by any code.
    expect(unhandled).toEqual([]);
  });

  it("a rejected promise from another realm, with an unreadable then, is still observed", async () => {
    const captured = muteRethrow();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { plot } = chart();
      const failure = new Error("the request failed elsewhere");
      const loader = infiniteHistory(
        plot,
        recordingSink().sink,
        () => {
          const foreign: Promise<LineDataPoint[]> = runInNewContext("Promise.reject(failure)", { failure });
          // oxlint-disable-next-line unicorn/no-thenable -- the thenable is the input under test
          Object.defineProperty(foreign, "then", {
            get() {
              throw new Error("then unavailable");
            },
          });
          return foreign;
        },
        { from: 100 },
      );
      plot.setVisibleRange(90, 110);
      await settle();
      await settle();

      expect(captured).toContain(failure);
      expect(loader.status()).toBe("idle");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("an attached getter that moves the view does not double a request", async () => {
    const { plot, handle } = chart();
    const { calls, fetch } = heldFetch();
    let nudged = false;
    const sink = {
      prepend: (page: LineDataPoint[]) => handle.prepend(page),
      get attached(): boolean {
        if (!nudged) {
          nudged = true;
          plot.setVisibleRange(80, 110); // re-enters the judgment and starts the request itself
        }
        return true;
      },
    };
    const loader = infiniteHistory(plot, sink, fetch, { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual([100]);
    expect(loader.status()).toBe("loading");
  });

  it("an attached getter that disposes and still says true stops the loader — before a fetch and at a landing", async () => {
    for (const when of ["before fetch", "at landing"]) {
      const { plot, handle } = chart();
      const held = heldFetch();
      const { calls, land } = held;
      let fetched = false;
      const fetch = (before: number) => {
        fetched = true;
        return held.fetch(before);
      };
      let loader: ReturnType<typeof infiniteHistory> | null = null;
      const sink = {
        prepend: (page: LineDataPoint[]) => handle.prepend(page),
        get attached(): boolean {
          if (when === "before fetch" || fetched) loader?.dispose();
          return true;
        },
      };
      loader = infiniteHistory(plot, sink, fetch, { from: 100 });
      plot.setVisibleRange(90, 110);
      if (when === "at landing") land([]);
      await settle();

      expect(loader.status()).toBe("stopped");
      expect(calls.length).toBe(when === "before fetch" ? 0 : 1);
    }
  });

  it("an accessor that disposes while the page trims to nothing leaves the loader stopped, not idle", async () => {
    muteRethrow();
    const { plot } = chart();
    let loader: ReturnType<typeof infiniteHistory> | null = null;
    const coordinates = {
      getX: (point: LineDataPoint) => {
        loader?.dispose();
        return point.x;
      },
      getY: (point: LineDataPoint) => point.y,
    };
    // Every point sits at or after the cursor — the trim leaves nothing.
    loader = infiniteHistory(plot, recordingSink().sink, servedFetch(points(100, 105)).fetch, { from: 100, coordinates });
    plot.setVisibleRange(90, 110);
    await settle();

    expect(loader.status()).toBe("stopped");
  });

  it("unsubscribing a status listener releases it", () => {
    const { plot } = chart();
    const loader = infiniteHistory(plot, recordingSink().sink, servedFetch().fetch, { from: 100 });
    const heard: HistoryStatus[] = [];
    const off = loader.statusChanges.subscribe((status) => void heard.push(status));
    plot.setVisibleRange(90, 110);
    expect(heard).toEqual(["loading"]);
    off();
    off();
    loader.dispose(); // a change that would be heard, if the listener were still there
    expect(loader.status()).toBe("stopped");
    expect(heard).toEqual(["loading"]);
  });
});
