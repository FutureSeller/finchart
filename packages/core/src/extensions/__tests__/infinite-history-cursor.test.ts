/**
 * `infiniteHistory` in cursor mode — for an API that pages by an opaque
 * token instead of an x. The fetch is handed the token and answers
 * `{ bars, next }`; the loader still trims and advances by x, delivers what
 * is older than what it holds, and moves the token only once a page has
 * been taken.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { LineDataPoint } from "../../data";
import { DataError, ContractError } from "../../primitives";
import { lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { infiniteHistory, type HistoryPage } from "../infinite-history";

const points = (from: number, to: number): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x < to; x++) out.push({ x, y: 1 });
  return out;
};

/** A real headless plot showing x 100..119. */
function chart(data = points(100, 120)) {
  const model = createPlotModel({ size: { width: 800, height: 600 }, series: null });
  const handle = model.plot.mainPane.addSeries({ series: lineSeries(), data });
  return { plot: model.plot, handle };
}

type Page = HistoryPage<LineDataPoint, string>;

/** Serves queued pages in order; records every cursor it was asked with. Runs out into `{ bars: [], next: null }`. */
function served(...pages: (Page | Error)[]) {
  const calls: string[] = [];
  return {
    calls,
    fetch: (cursor: string): Promise<Page> => {
      calls.push(cursor);
      const next = pages.shift();
      if (next === undefined) return Promise.resolve({ bars: [], next: null });
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
}

/**
 * Records every page. Given the chart's handle, it also lands each page
 * there — a page counts once the chart holds it, so a test that expects the
 * loader to keep going has to let its pages reach the chart.
 */
function recordingSink(handle?: { prepend(points: LineDataPoint[]): void }) {
  const pages: LineDataPoint[][] = [];
  return {
    pages,
    sink: (page: LineDataPoint[]) => {
      pages.push(page);
      handle?.prepend(page);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe("infiniteHistory — cursor mode", () => {
  it("asks with the cursor it was given, then with each page's next, chaining a gap without events", async () => {
    const { plot, handle } = chart();
    const { calls, fetch } = served(
      { bars: points(80, 100), next: "c2" },
      { bars: points(60, 80), next: "c3" },
      { bars: points(40, 60), next: "c4" },
    );
    const { pages, sink } = recordingSink(handle);
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(50, 70);
    await settle();

    expect(calls).toEqual(["c1", "c2", "c3"]);
    expect(pages).toEqual([points(80, 100), points(60, 80), points(40, 60)]);
    expect(loader.status()).toBe("idle");
  });

  it("delivers the last page — bars with next: null — and then reads done", async () => {
    const { plot } = chart();
    const { calls, fetch } = served({ bars: points(80, 100), next: null });
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(50, 70);
    await settle();
    expect(pages).toEqual([points(80, 100)]);
    expect(loader.status()).toBe("done");

    plot.setVisibleRange(40, 60);
    await settle();
    expect(calls).toEqual(["c1"]);
  });

  it("an empty page with no next is the end — done, nothing delivered", async () => {
    const { plot } = chart();
    const { fetch } = served({ bars: [], next: null });
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(90, 110);
    await settle();
    expect(pages).toEqual([]);
    expect(loader.status()).toBe("done");
  });

  it("an empty page with a next is not the end — the cursor moves and the gap keeps filling with no gesture", async () => {
    const { plot } = chart();
    const { calls, fetch } = served(
      { bars: [], next: "c2" },
      { bars: points(80, 100), next: null },
    );
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(90, 110);
    await settle();

    expect(calls).toEqual(["c1", "c2"]);
    expect(pages).toEqual([points(80, 100)]);
    expect(loader.status()).toBe("done");
  });

  it("a page whose bars all sit at or after the frontier counts as empty — no cursor-ignored error, the cursor moves", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const { calls, fetch } = served(
      { bars: points(100, 105), next: "c2" },
      { bars: points(90, 101), next: null },
    );
    const { pages, sink } = recordingSink();
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(95, 115);
    await settle();

    expect(calls).toEqual(["c1", "c2"]);
    expect(pages).toEqual([points(90, 100)]);
    expect(captured).toEqual([]);
    expect(loader.status()).toBe("done");
  });

  it("outside a gap an empty page moves the cursor and waits — the next gesture asks with the new one", async () => {
    const { plot } = chart();
    const { calls, fetch } = served({ bars: [], next: "c2" }, { bars: points(80, 100), next: null });
    infiniteHistory(plot, recordingSink().sink, fetch, { from: 100, cursor: "c1" });

    // Prefetch: a left move with runway under a screen, no gap.
    plot.setVisibleRange(103, 118);
    plot.setVisibleRange(102, 117);
    await settle();
    expect(calls).toEqual(["c1"]);

    plot.setVisibleRange(101, 116);
    await settle();
    expect(calls).toEqual(["c1", "c2"]);
  });

  it("nine pages in a row that keep no older bar terminate with a DataError; eight do not", async () => {
    const empties = (count: number) =>
      Array.from({ length: count }, (_, i): Page => ({ bars: [], next: `e${i + 1}` }));

    {
      const captured = muteRethrow();
      const { plot } = chart();
      const { calls, fetch } = served(...empties(9), { bars: points(80, 100), next: null });
      const loader = infiniteHistory(plot, recordingSink().sink, fetch, { from: 100, cursor: "c1" });
      plot.setVisibleRange(90, 110);
      await settle();
      expect(loader.status()).toBe("terminated");
      expect(calls).toHaveLength(9);
      expect(captured.some((error) => error instanceof DataError && /9 consecutive pages/.test(error.message))).toBe(true);
    }

    {
      const { plot } = chart();
      const { pages, sink } = recordingSink();
      const { calls, fetch } = served(...empties(8), { bars: points(80, 100), next: null });
      const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });
      plot.setVisibleRange(90, 110);
      await settle();
      expect(calls).toHaveLength(9);
      expect(pages).toEqual([points(80, 100)]);
      expect(loader.status()).toBe("done");
    }
  });

  it("a page that keeps bars resets the run of empty pages — progress is never capped", async () => {
    const empties = (tag: string, count: number) =>
      Array.from({ length: count }, (_, i): Page => ({ bars: [], next: `${tag}${i}` }));
    const { plot, handle } = chart();
    const { pages, sink } = recordingSink(handle);
    const { fetch } = served(
      ...empties("a", 8),
      { bars: points(90, 100), next: "b" },
      ...empties("c", 8),
      { bars: points(80, 90), next: "d" },
      ...empties("e", 8),
      { bars: points(70, 80), next: null },
    );
    const loader = infiniteHistory(plot, sink, fetch, { from: 100, cursor: "c1" });

    plot.setVisibleRange(70, 90);
    await settle();
    expect(pages).toEqual([points(90, 100), points(80, 90), points(70, 80)]);
    expect(loader.status()).toBe("done");
  });

  it("the token is never compared — the same token with older bars is progress", async () => {
    const { plot, handle } = chart();
    const { calls, fetch } = served(
      { bars: points(80, 100), next: "same" },
      { bars: points(60, 80), next: "same" },
      { bars: points(40, 60), next: null },
    );
    const { pages, sink } = recordingSink(handle);
    infiniteHistory(plot, sink, fetch, { from: 100, cursor: "same" });

    plot.setVisibleRange(40, 60);
    await settle();
    expect(calls).toEqual(["same", "same", "same"]);
    expect(pages).toHaveLength(3);
  });

  it("a sink that throws keeps both the cursor and the frontier — the next gesture asks with the same token", async () => {
    const captured = muteRethrow();
    const { plot } = chart();
    const { calls, fetch } = served({ bars: points(80, 100), next: "c2" }, { bars: points(80, 100), next: "c2" });
    let failures = 1;
    const pages: LineDataPoint[][] = [];
    const loader = infiniteHistory(
      plot,
      (page) => {
        if (failures-- > 0) throw new Error("sink failed");
        pages.push(page);
      },
      fetch,
      { from: 100, cursor: "c1" },
    );

    plot.setVisibleRange(95, 115);
    await settle();
    expect(loader.status()).toBe("idle");
    expect(captured).toHaveLength(1);

    plot.setVisibleRange(94, 114);
    await settle();
    expect(calls).toEqual(["c1", "c1"]);
    expect(pages).toEqual([points(80, 100)]);
  });

  it("a last page whose delivery fails is not the end — idle, and the retry asks with the same token", async () => {
    muteRethrow();
    const { plot } = chart();
    const { calls, fetch } = served({ bars: points(80, 100), next: null }, { bars: points(80, 100), next: null });
    let failures = 1;
    const loader = infiniteHistory(
      plot,
      () => {
        if (failures-- > 0) throw new Error("sink failed");
      },
      fetch,
      { from: 100, cursor: "c1" },
    );

    plot.setVisibleRange(95, 115);
    await settle();
    expect(loader.status()).toBe("idle");
    plot.setVisibleRange(94, 114);
    await settle();
    expect(calls).toEqual(["c1", "c1"]);
    expect(loader.status()).toBe("done");
  });

  it("a page that is not { bars, next } — an array, null, bars missing, next missing — terminates", async () => {
    const shapes: unknown[] = [points(80, 100), null, { next: "c2" }, { bars: points(80, 100) }, { bars: "no", next: null }];
    for (const shape of shapes) {
      const captured = muteRethrow();
      const { plot } = chart();
      const { pages, sink } = recordingSink();
      const loader = infiniteHistory<LineDataPoint, string>(
        plot,
        sink,
        // @ts-expect-error — the shape is wrong on purpose: `response.json()` hands back whatever the server sent
        () => Promise.resolve(shape),
        { from: 100, cursor: "c1" },
      );
      plot.setVisibleRange(90, 110);
      await settle();
      expect(loader.status()).toBe("terminated");
      expect(pages).toEqual([]);
      expect(captured.some((error) => error instanceof DataError)).toBe(true);
      vi.restoreAllMocks();
    }

    // An x fetch's array handed to a cursor loader says so — the likeliest mix-up.
    const captured = muteRethrow();
    const { plot } = chart();
    infiniteHistory<LineDataPoint, string>(
      plot,
      recordingSink().sink,
      // @ts-expect-error — an x-mode page on purpose
      () => Promise.resolve(points(80, 100)),
      { from: 100, cursor: "c1" },
    );
    plot.setVisibleRange(90, 110);
    await settle();
    expect(captured.some((error) => error instanceof DataError && /is an array, not \{ bars, next \}/.test(error.message))).toBe(true);
  });

  it("a detached handle stops a cursor loader like an x one", async () => {
    const { plot, handle } = chart();
    const pending: ((page: Page) => void)[] = [];
    const loader = infiniteHistory(plot, handle, () => new Promise<Page>((resolve) => pending.push(resolve)), {
      from: 100,
      cursor: "c1",
    });
    plot.setVisibleRange(90, 110);
    handle.dispose();
    pending[0]?.({ bars: points(80, 100), next: "c2" });
    await settle();
    expect(loader.status()).toBe("stopped");
  });

  it("a page that detaches the handle while it is read — through next, or through the accessor while trimming — stops the loader, never done or idle", async () => {
    const detachingPages = (handle: { dispose(): void }): Page[] => [
      {
        bars: [],
        get next() {
          handle.dispose();
          return null;
        },
      },
      {
        bars: [],
        get next() {
          handle.dispose();
          return "c2";
        },
      },
    ];
    for (const index of [0, 1]) {
      const { plot, handle } = chart();
      const page = detachingPages(handle)[index];
      const calls: string[] = [];
      const loader = infiniteHistory(
        plot,
        handle,
        (cursor: string) => {
          calls.push(cursor);
          return page;
        },
        { from: 100, cursor: "c1" },
      );
      plot.setVisibleRange(90, 110);
      await settle();
      expect(loader.status()).toBe("stopped");
      expect(calls).toEqual(["c1"]);
    }

    // The accessor detaches while every bar trims away — with or without a
    // next, the loader goes straight to stopped: never through idle or done.
    for (const next of [null, "c2"]) {
      const { plot, handle } = chart();
      const heard: string[] = [];
      const loader = infiniteHistory(
        plot,
        handle,
        (): Page => ({ bars: points(100, 103), next }),
        {
          from: 100,
          cursor: "c1",
          coordinates: {
            getX: (point) => {
              handle.dispose();
              return point.x;
            },
            getY: (point) => point.y,
          },
        },
      );
      loader.statusChanges.subscribe((status) => void heard.push(status));
      plot.setVisibleRange(90, 110);
      await settle();
      expect(heard).toEqual(["loading", "stopped"]);
    }
  });

  it("a handle whose prepend detaches it leaves the loader stopped — nothing committed, in either mode", async () => {
    const cases: Array<{ next: string | null } | "x"> = [{ next: null }, { next: "c2" }, "x"];
    for (const mode of cases) {
      const { plot, handle } = chart();
      const selfDetaching = {
        prepend(page: LineDataPoint[]) {
          handle.prepend(page);
          handle.dispose();
        },
        get attached() {
          return handle.attached;
        },
      };
      const heard: string[] = [];
      const loader =
        mode === "x"
          ? infiniteHistory(plot, selfDetaching, () => points(80, 100), { from: 100 })
          : infiniteHistory(plot, selfDetaching, (): Page => ({ bars: points(80, 100), next: mode.next }), {
              from: 100,
              cursor: "c1",
            });
      loader.statusChanges.subscribe((status) => void heard.push(status));
      plot.setVisibleRange(50, 70);
      await settle();
      expect(heard).toEqual(["loading", "stopped"]);
    }
  });

  it("a read that detaches the handle and then throws leaves the loader stopped, not terminated — next getter or accessor, either mode", async () => {
    const captured = muteRethrow();
    const detachThenThrow = (handle: { dispose(): void }) => {
      handle.dispose();
      throw new Error("read failed");
    };
    const make = (which: "next" | "accessor-cursor" | "accessor-x") => {
      const { plot, handle } = chart();
      const accessor = {
        getX: (): number => detachThenThrow(handle),
        getY: (point: LineDataPoint) => point.y,
      };
      const loader =
        which === "next"
          ? infiniteHistory(
              plot,
              handle,
              (): Page => ({
                bars: points(80, 100),
                get next(): string {
                  return detachThenThrow(handle);
                },
              }),
              { from: 100, cursor: "c1" },
            )
          : which === "accessor-cursor"
            ? infiniteHistory(plot, handle, (): Page => ({ bars: points(80, 100), next: "c2" }), {
                from: 100,
                cursor: "c1",
                coordinates: accessor,
              })
            : infiniteHistory(plot, handle, () => points(80, 100), { from: 100, coordinates: accessor });
      return { plot, loader };
    };
    const kinds: Array<"next" | "accessor-cursor" | "accessor-x"> = ["next", "accessor-cursor", "accessor-x"];
    for (const which of kinds) {
      const { plot, loader } = make(which);
      plot.setVisibleRange(90, 110);
      await settle();
      expect(loader.status()).toBe("stopped");
    }
    expect(captured.length).toBeGreaterThan(0);
  });

  it("no failure recovers a detached handle to idle — trim, sink, synchronous fetch, rejection, thenable; either mode", async () => {
    muteRethrow();
    type Handle = ReturnType<typeof chart>["handle"];
    type Scenario = {
      name: string;
      fetch: (handle: Handle) => (arg: never) => unknown;
      sink?: (handle: Handle) => { prepend(page: LineDataPoint[]): void; readonly attached: boolean };
      coordinates?: (handle: Handle) => { getX(point: LineDataPoint): number; getY(point: LineDataPoint): number | null };
    };
    const fail = (handle: Handle): never => {
      handle.dispose();
      throw new Error("failed");
    };
    const scenarios: Scenario[] = [
      {
        name: "an accessor that detaches while the whole page trims away (x mode)",
        fetch: () => () => points(100, 103),
        coordinates: (handle) => ({
          getX: (point) => {
            handle.dispose();
            return point.x;
          },
          getY: (point) => point.y,
        }),
      },
      {
        name: "a prepend that detaches and throws",
        fetch: () => () => points(80, 100),
        sink: (handle) => ({
          prepend: () => fail(handle),
          get attached() {
            return handle.attached;
          },
        }),
      },
      { name: "a synchronous fetch that detaches and throws", fetch: (handle) => () => fail(handle) },
      {
        name: "a fetch that rejects after the handle went",
        fetch: (handle) => () =>
          Promise.resolve().then(() => {
            handle.dispose();
            throw new Error("rejected");
          }),
      },
      {
        name: "a thenable whose then detaches and throws",
        fetch: (handle) => () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- a thenable on purpose: its then is the consumer code under test
          then: () => fail(handle),
        }),
      },
    ];
    for (const scenario of scenarios) {
      for (const mode of ["x", "cursor"]) {
        if (mode === "cursor" && scenario.coordinates) continue;
        const { plot, handle } = chart();
        const sink = scenario.sink ? scenario.sink(handle) : handle;
        // In cursor mode a delivering fetch answers a page; a failing one fails the same way.
        const fetch = scenario.sink && mode === "cursor" ? () => ({ bars: points(80, 100), next: "c2" }) : scenario.fetch(handle);
        const loader =
          mode === "x"
            ? infiniteHistory<LineDataPoint>(
                plot,
                sink,
                (before) => Reflect.apply(fetch, undefined, [before]),
                { from: 100, coordinates: scenario.coordinates?.(handle) },
              )
            : infiniteHistory<LineDataPoint, string>(
                plot,
                sink,
                (cursor) => Reflect.apply(fetch, undefined, [cursor]),
                { from: 100, cursor: "c1" },
              );
        const heard: string[] = [];
        loader.statusChanges.subscribe((status) => void heard.push(status));
        plot.setVisibleRange(90, 110);
        await settle();
        expect({ scenario: scenario.name, mode, heard }).toEqual({ scenario: scenario.name, mode, heard: ["loading", "stopped"] });
      }
    }
  });

  it("an x-mode empty page whose reads detach the handle stops the loader instead of reading done", async () => {
    const { plot, handle } = chart();
    const empty = new Proxy<LineDataPoint[]>([], {
      get(target, key, receiver) {
        if (key === "length") handle.dispose();
        return Reflect.get(target, key, receiver);
      },
    });
    const loader = infiniteHistory(plot, handle, () => empty, { from: 100 });
    plot.setVisibleRange(90, 110);
    await settle();
    expect(loader.status()).toBe("stopped");
  });

  /**
   * **Where the loader stands, readable.** A consumer whose chart remounts
   * (a React key) starts a new loader from what it holds — the first x is
   * in its data, but the token is not: an empty page moves it without
   * reaching the sink. `cursor()` is the token the next fetch would be
   * asked with, `null` once there is none.
   */
  it("reads the token the next fetch would take — moved by an empty page too, null once done", async () => {
    const { plot, handle } = chart();
    const { fetch } = served(
      { bars: [], next: "c2" },
      { bars: points(90, 100), next: "c3" },
      { bars: points(80, 90), next: null },
    );
    const loader = infiniteHistory(plot, recordingSink(handle).sink, fetch, { from: 100, cursor: "c1" });
    expect(loader.cursor()).toBe("c1");

    // Prefetch without a gap: the empty page moves the token and waits.
    plot.setVisibleRange(103, 118);
    plot.setVisibleRange(102, 117);
    await settle();
    expect(loader.cursor()).toBe("c2");

    plot.setVisibleRange(85, 105);
    await settle();
    plot.render();
    await settle();
    expect(loader.status()).toBe("done");
    expect(loader.cursor()).toBeNull();
  });

  it("refuses a null starting cursor — null means there is no next page", () => {
    const { plot } = chart();
    expect(() =>
      infiniteHistory<LineDataPoint, string>(plot, recordingSink().sink, served().fetch, {
        from: 100,
        // @ts-expect-error — a cursor loader starts from a token
        cursor: null,
      }),
    ).toThrow(ContractError);
  });

  it("types keep the two modes apart", () => {
    const { plot } = chart();
    const { sink } = recordingSink();
    const byToken = served().fetch;
    const byX = (before: number) => points(before - 10, before);

    // @ts-expect-error — a cursor fetch needs a starting cursor
    infiniteHistory(plot, sink, byToken, { from: 100 }).dispose();

    // A cursor carried in a variable still can't reach an x fetch.
    const options = { from: 100, cursor: "c1" };
    // @ts-expect-error — an x fetch takes no cursor
    infiniteHistory(plot, sink, byX, options).dispose();

    // @ts-expect-error — the cursor's type is the fetch's
    infiniteHistory(plot, sink, byToken, { from: 100, cursor: 7 }).dispose();

    infiniteHistory(plot, sink, byX, { from: 100 }).dispose();
    infiniteHistory(plot, sink, byToken, { from: 100, cursor: "c1" }).dispose();
  });
});
