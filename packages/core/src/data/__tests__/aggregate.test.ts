import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import { fixedBars } from "../../time";
import type { OHLC } from "../types";
import type { Trade } from "../aggregate";
import { tailDelta } from "../tail-delta";
import { barAggregator } from "../aggregate";
import { OhlcAggregation } from "../aggregation";

const MINUTE = 60 * 1000;
const minutes = () => barAggregator({ barStart: fixedBars({ interval: MINUTE }) });
const at = (iso: string) => Date.parse(iso);

describe("barAggregator — fold, the primitive", () => {
  it("opens a bar on the first trade, at its bar's start", () => {
    const bar = minutes().fold(null, { x: at("2026-03-02T07:41:29.750Z"), price: 100 });

    expect(bar).toEqual({
      x: at("2026-03-02T07:41:00Z"),
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    });
  });

  it("folds three trades of the same minute into one bar", () => {
    const feed = minutes();
    let bar = feed.fold(null, { x: at("2026-03-02T07:41:01Z"), price: 100, volume: 5 });
    bar = feed.fold(bar, { x: at("2026-03-02T07:41:20Z"), price: 104, volume: 2 });
    bar = feed.fold(bar, { x: at("2026-03-02T07:41:59Z"), price: 98, volume: 3 });

    expect(bar).toEqual({
      x: at("2026-03-02T07:41:00Z"),
      open: 100,
      high: 104,
      low: 98,
      close: 98,
      volume: 10,
    });
  });

  /**
   * **The close is the last to arrive, not the last to have happened.** A
   * pure reducer is handed one trade and the bar so far; it never learns
   * the timestamp of the trade that set the close, so it cannot rule on
   * which of two came first. Ordering inside a bar is the feed's job.
   */
  it("lets a late arrival inside the bar set the close", () => {
    const feed = minutes();
    const first = feed.fold(null, { x: at("2026-03-02T07:41:50Z"), price: 100 });
    const bar = feed.fold(first, { x: at("2026-03-02T07:41:10Z"), price: 90 });

    expect(bar.close).toBe(90);
    expect(bar.x).toBe(at("2026-03-02T07:41:00Z"));
  });

  /**
   * **Volume follows the rule the merge already set**: add what is there,
   * and if none of it is, leave the key off. A bar built only from trades
   * without volume is the same shape as one `OhlcAggregation` produces —
   * the key absent, not `volume: null`.
   */
  it("adds only the volume that is there", () => {
    const feed = minutes();
    let bar = feed.fold(null, { x: at("2026-03-02T07:41:01Z"), price: 100, volume: null });
    bar = feed.fold(bar, { x: at("2026-03-02T07:41:02Z"), price: 101 });

    expect("volume" in bar).toBe(false);

    const mixed = feed.fold(bar, { x: at("2026-03-02T07:41:03Z"), price: 102, volume: 7 });
    expect(mixed.volume).toBe(7);
  });

  /**
   * **A bar is rebuilt field by field, so every field it should keep has to
   * be named.** Spreading would carry a label for free and a stale gap
   * along with it; naming them means a forgotten one disappears, which is
   * what this is here to catch. `merge` carries the first bar's label the
   * same way.
   */
  it("carries a label through the fold, the way a merge does", () => {
    const feed = minutes();
    const seeded: OHLC = {
      x: at("2026-03-02T07:41:00Z"),
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      label: "open",
    };

    expect(feed.fold(seeded, { x: at("2026-03-02T07:41:30Z"), price: 104 })).toEqual({
      ...seeded,
      high: 104,
      close: 104,
    });
  });

  /**
   * **What a bar is, is what `OHLC` says it is.** Building the fields by
   * name means a field a consumer hung on the object of their own accord
   * does not survive — which is exactly what a merge does with it, and the
   * point is that the two agree. Spreading and deleting the stale volume
   * would keep it, and diverge.
   */
  it("drops a field that is not a bar's, the way a merge does", () => {
    const feed = minutes();
    const seeded: OHLC & { vendor?: string } = {
      x: at("2026-03-02T07:41:00Z"),
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      vendor: "somebody's own",
    };
    const merged = new OhlcAggregation().decimate(
      [seeded, { ...seeded, x: seeded.x + 1 }],
      { start: 0, end: 2 },
      0.5,
    )[0];
    const folded = feed.fold(seeded, { x: at("2026-03-02T07:41:30Z"), price: 104 });

    expect("vendor" in folded).toBe(false);
    expect(Object.keys(folded).sort()).toEqual(Object.keys(merged).sort());
  });

  it("opens a new bar when the trade belongs to the next one", () => {
    const feed = minutes();
    const first = feed.fold(null, { x: at("2026-03-02T07:41:30Z"), price: 100 });
    const second = feed.fold(first, { x: at("2026-03-02T07:42:01Z"), price: 105 });

    expect(second.x).toBe(at("2026-03-02T07:42:00Z"));
    expect(second.open).toBe(105);
    expect(first.close).toBe(100);
  });

  /**
   * **"I did not eat this" is said with identity.** A trade older than the
   * bar in progress cannot be folded without rewriting history, so the same
   * object comes back and a consumer can leave everything alone.
   */
  it("hands back the very same bar for a trade already past", () => {
    const feed = minutes();
    const bar = feed.fold(null, { x: at("2026-03-02T07:42:30Z"), price: 100 });
    const again = feed.fold(bar, { x: at("2026-03-02T07:41:59Z"), price: 90 });

    expect(again).toBe(bar);
  });
});

describe("chokepoint 11 — a trade's own price and volume", () => {
  /**
   * **Folding erases what it is handed, so this is the last place the
   * number can be seen.** A price that is not a number loses every
   * comparison it is in — it neither raises the high nor lowers the low —
   * and lands only on the close, where the next trade overwrites it. Its
   * volume is in the sum by then. What reaches the data door is a bar that
   * adds up wrong and looks perfectly well formed, and a conflated feed
   * delivers only that bar, so nothing downstream ever sees the trade at
   * all.
   */
  it("refuses a price that is not a number, before it can vanish", () => {
    const feed = minutes();
    const opened = feed.fold(null, { x: at("2026-03-02T07:41:01Z"), price: 100, volume: 1 });

    expect(() =>
      feed.fold(opened, { x: at("2026-03-02T07:41:02Z"), price: Number.NaN, volume: 7 }),
    ).toThrow(ContractError);
    // The bar it was folding into is untouched, so a caller that catches
    // can carry on with what it had.
    expect(opened.volume).toBe(1);
  });

  /**
   * A volume a feed did not send is a gap and folds to nothing; one it got
   * wrong is a number that poisons the sum and every bar after it.
   */
  it("refuses a volume that is not a number, and takes a missing one", () => {
    const feed = minutes();
    const opened = feed.fold(null, { x: at("2026-03-02T07:41:01Z"), price: 100, volume: 1 });

    expect(() =>
      feed.fold(opened, { x: at("2026-03-02T07:41:02Z"), price: 101, volume: Number.NaN }),
    ).toThrow(ContractError);
    expect(feed.fold(opened, { x: at("2026-03-02T07:41:02Z"), price: 101 }).volume).toBe(1);
  });

  /**
   * **An x that is not a number must not become the epoch.** Everything
   * `Math.floor` takes to zero — `null`, a string, `false`, an empty array
   * — would otherwise fold into a perfectly well-formed bar at the epoch,
   * carrying its volume with it, and nothing downstream would ever know a
   * trade had been mislaid.
   */
  it("refuses a timestamp that is not a number, rather than filing it at the epoch", () => {
    const feed = minutes();
    const fold = (trade: unknown): unknown =>
      (feed.fold as (bar: OHLC | null, trade: unknown) => unknown)(null, trade);

    for (const x of [null, undefined, "0", false, []]) {
      expect(() => fold({ x, price: 100, volume: 7 })).toThrow(ContractError);
    }
  });

  /**
   * **A bar start is the consumer's to write, and a fold cannot assume it
   * refuses anything.** The two shipped in core do; `x => Math.floor(x /
   * 60000) * 60000` does not, and answers `NaN`. That loses both
   * comparisons, lands in the same-bar branch, and adds the trade's volume
   * to a bar the trade never belonged to — the trade gone, its volume
   * kept.
   */
  it("refuses an answer from a barStart that is no bar", () => {
    const naive = barAggregator({ barStart: (x) => Math.floor(x / 60_000) * 60_000 });
    const opened = naive.fold(null, { x: 0, price: 100, volume: 1 });

    expect(() => naive.fold(opened, { x: Number.NaN, price: 100, volume: 7 })).toThrow(
      ContractError,
    );
    // And one that answers nonsense for a perfectly good x.
    const broken = barAggregator({ barStart: () => Number.NaN });
    expect(() => broken.fold(null, { x: 0, price: 100 })).toThrow(ContractError);
    expect(opened.volume).toBe(1);
  });

  /**
   * **Two volumes a door would each let through can add to one it would
   * not.** The bar carries the sum, so the sum is what has to be a number
   * — and an infinite one poisons every trade folded after it, the same
   * way a `NaN` did.
   */
  it("refuses a sum that is no longer a number", () => {
    const feed = minutes();
    const opened = feed.fold(null, {
      x: at("2026-03-02T07:41:01Z"),
      price: 100,
      volume: Number.MAX_VALUE,
    });

    expect(() =>
      feed.fold(opened, {
        x: at("2026-03-02T07:41:02Z"),
        price: 100,
        volume: Number.MAX_VALUE,
      }),
    ).toThrow(ContractError);
    expect(opened.volume).toBe(Number.MAX_VALUE);
  });

  it("refuses through reduce too, which folds", () => {
    const feed = minutes();
    const bars = feed.reduce([], { x: at("2026-03-02T07:41:01Z"), price: 100 });

    expect(() =>
      feed.reduce(bars, { x: at("2026-03-02T07:41:02Z"), price: Number.POSITIVE_INFINITY }),
    ).toThrow(ContractError);
  });
});

describe("barAggregator — the door", () => {
  /**
   * Reached the way a consumer without types reaches it: the value stays
   * unknown and the door is what widens. A `barStart` that is not a
   * function would otherwise surface as a `TypeError` inside a feed
   * handler, a long way from the call that got it wrong.
   */
  it.each([null, undefined, {}, { barStart: 60_000 }, { barStart: null }])(
    "refuses %o",
    (options) => {
      const open = (given: unknown): unknown =>
        (barAggregator as (given: unknown) => unknown)(given);

      expect(() => open(options)).toThrow(ContractError);
    },
  );
});

/**
 * **One question, one answer.** A bar folded from trades and a bar merged
 * from those same trades have to come out the same shape — otherwise the
 * core says two different things about what a bar without volume is, and a
 * consumer comparing a live bar against a history page sees a difference
 * that is not in the data. Volume is where they could drift: a `null`
 * seeded as `0`, or a present-then-absent run leaving the key on.
 */
describe("barAggregator — the same bar the merge would make", () => {
  /** Deterministic, so a failure names one seed rather than a mood. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("matches OhlcAggregation over every mix of present and absent volume", () => {
    const volumes = [undefined, null, 0, -0, 1, 7, 0.5];
    const next = random(20260909);
    const feed = minutes();
    const merger = new OhlcAggregation();

    for (let trial = 0; trial < 2000; trial++) {
      const trades = Array.from(
        { length: 1 + Math.floor(next() * 5) },
        (): Trade => {
          const volume = volumes[Math.floor(next() * volumes.length)];
          const trade: Trade = {
            x: at("2026-03-02T07:41:00Z") + Math.floor(next() * 60000),
            price: 90 + Math.floor(next() * 20),
          };
          if (volume !== undefined) trade.volume = volume;
          return trade;
        },
      ).sort((a, b) => a.x - b.x);

      /**
       * Sometimes from nothing, sometimes from a bar already in hand —
       * live folding resumes from a history page, and there `volume: null`
       * is a valid thing to have been handed. Starting every trial from
       * nothing would never fold *into* a gap.
       */
      const seeded = volumes[Math.floor(next() * volumes.length)];
      const carry = next() < 0.5;
      const seed: OHLC = {
        x: at("2026-03-02T07:41:00Z"),
        open: 95,
        high: 96,
        low: 94,
        close: 95,
        // Carried by both, and only here — without it, dropping the merge's
        // own label carry would leave every test in this file green.
        label: "seeded",
      };
      if (carry && seeded !== undefined) seed.volume = seeded;

      let folded: OHLC | null = carry ? seed : null;
      for (const trade of trades) folded = feed.fold(folded, trade);

      // The same trades as one-trade bars, put through the merge. A
      // threshold under one keeps it from passing them through untouched.
      const bars = trades.map((trade): OHLC => {
        const bar: OHLC = {
          x: trade.x,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
        };
        if (trade.volume !== undefined) bar.volume = trade.volume;
        return bar;
      });
      if (carry) bars.unshift(seed);
      const merged = merger.decimate(bars, { start: 0, end: bars.length }, 0.5)[0];

      // x is the one thing that differs by design: a merge keeps the first
      // bar's x, a fold answers where the bar it belongs to began.
      expect({ ...folded, x: merged.x }).toEqual(merged);
      expect(Object.keys(folded!).sort()).toEqual(Object.keys(merged).sort());
    }
  });
});

describe("barAggregator — reduce, the wrapper", () => {
  it("seeds from an empty array", () => {
    const bars = minutes().reduce([], { x: at("2026-03-02T07:41:30Z"), price: 100 });

    expect(bars).toHaveLength(1);
    expect(bars[0].x).toBe(at("2026-03-02T07:41:00Z"));
  });

  /**
   * **The front keeps its object identity**, which is the whole contract:
   * that is what lets `tailDelta` call the change a replace or an append
   * instead of sending every indicator down the full path.
   */
  it("keeps the front identical and replaces the last bar", () => {
    const feed = minutes();
    const before = [
      feed.fold(null, { x: at("2026-03-02T07:38:10Z"), price: 90 }),
      feed.fold(null, { x: at("2026-03-02T07:39:10Z"), price: 92 }),
      feed.fold(null, { x: at("2026-03-02T07:40:10Z"), price: 95 }),
      feed.fold(null, { x: at("2026-03-02T07:41:10Z"), price: 100 }),
    ];
    const after = feed.reduce(before, { x: at("2026-03-02T07:41:40Z"), price: 104 });

    for (let i = 0; i < before.length - 1; i++) expect(after[i]).toBe(before[i]);
    expect(after[3]).not.toBe(before[3]);
    expect(tailDelta(before, after)).toEqual({ kind: "replace", count: 1 });
  });

  it("appends exactly one bar when the trade rolls over", () => {
    const feed = minutes();
    const before = [
      feed.fold(null, { x: at("2026-03-02T07:38:10Z"), price: 90 }),
      feed.fold(null, { x: at("2026-03-02T07:39:10Z"), price: 95 }),
      feed.fold(null, { x: at("2026-03-02T07:41:10Z"), price: 100 }),
    ];
    const after = feed.reduce(before, { x: at("2026-03-02T07:59:00Z"), price: 105 });

    expect(after).toHaveLength(4);
    // Every bar in front, not just the first — a copy of the middle would
    // otherwise pass while breaking exactly what tailDelta reads.
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
    expect(tailDelta(before, after)).toEqual({ kind: "append", count: 1 });
  });

  it("returns the same array for a trade already past", () => {
    const feed = minutes();
    const before = [feed.fold(null, { x: at("2026-03-02T07:41:10Z"), price: 100 })];
    const after = feed.reduce(before, { x: at("2026-03-02T07:40:00Z"), price: 90 });

    expect(after).toBe(before);
  });

  /**
   * `tailDelta` reads a seed as unclassifiable rather than as an append of
   * one — the consumer's first frame is a `setData`, not a tail change.
   */
  it("seeds a change tailDelta will not classify", () => {
    const bars = minutes().reduce([], { x: at("2026-03-02T07:41:30Z"), price: 100 });

    expect(tailDelta([] as OHLC[], bars)).toBeNull();
  });
});
