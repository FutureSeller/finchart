import type { OHLC, Source } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { periodAnchor } from "../anchors";
import { sessionStart } from "@finchart/core";
import { pivotPoints, vwap } from "../factories";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);

/** Bars every hour from an instant, priced so nothing is degenerate. */
function hourly(from: string, count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => ({
    x: at(from) + i * HOUR,
    open: 100 + i,
    high: 102 + i,
    low: 98 + i,
    close: 101 + i,
    volume: 10,
  }));
}

const source = (bars: OHLC[]): Source<OHLC> => ({ read: () => bars });

describe("anchor sees the bar before it", () => {
  /**
   * **A session boundary is a comparison, not a property of one bar.** The
   * question "did a new session open here" cannot be answered by looking at
   * this bar alone — it needs the bar behind it. Without the third
   * argument, every consumer had to close over the array and index it
   * again.
   */
  it("hands vwap's anchor the previous bar, and null at the first", () => {
    const bars = hourly("2026-03-02T00:00Z", 4);
    const seen: (OHLC | null)[] = [];

    vwap(source(bars), {
      anchor: (_point, _index, previous) => {
        seen.push(previous);
        return false;
      },
    }).out.vwap.read();

    expect(seen).toEqual([null, bars[0], bars[1], bars[2]]);
  });

  it("hands pivotPoints's anchor the previous bar too", () => {
    const bars = hourly("2026-03-02T00:00Z", 4);
    const seen: (OHLC | null)[] = [];

    pivotPoints(source(bars), {
      anchor: (_point, _index, previous) => {
        seen.push(previous);
        return false;
      },
    }).out.p.read();

    // index 0 opens a period without asking, so the walk starts at 1.
    expect(seen).toEqual([bars[0], bars[1], bars[2]]);
  });
});

describe("periodAnchor", () => {
  it("opens on the first bar, and again on each new session", () => {
    const opens = periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) });
    const bars = hourly("2026-03-02T22:00Z", 5);

    expect(bars.map((bar, i) => opens(bar, i, i === 0 ? null : bars[i - 1]))).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  /**
   * **The claim the documentation makes, computed rather than asserted.**
   * Whether a tape holds a UTC-midnight bar at all is arithmetic: bars of
   * width `step` from an opening `offset` past midnight reach it exactly
   * when `gcd(step, day)` divides `offset`. Writing that as a list of
   * cadences is how it went wrong twice — "hourly" reads like it belongs
   * beside "daily" and "six-hourly", and an hour divides five hours; then
   * "a width that does not divide five hours never can" reads true and is
   * not, because seven-hour bars reach midnight after thirteen of them.
   * So the rule is asserted, and the cases the prose names are checked
   * against it rather than against my reading of it.
   */
  it("has a midnight-UTC bar exactly when the step's common measure divides the offset", () => {
    const open = at("2026-03-02T05:00Z");
    const offset = open % DAY;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

    for (const hours of [1, 2, 3, 4, 5, 6, 7, 8, 12, 24]) {
      const step = hours * HOUR;
      const bars = Array.from({ length: Math.ceil((60 * DAY) / step) }, (_, i) => open + i * step);

      expect({ hours, midnight: bars.some((x) => x % DAY === 0) }).toEqual({
        hours,
        midnight: offset % gcd(step, DAY) === 0,
      });
    }
  });

  /**
   * And the cadences the documentation happens to name, pinned as numbers
   * so the arithmetic behind them is not taken on anyone's word. They fix
   * the arithmetic, not the sentence: nothing here reads the documentation,
   * so a rewrite of it still answers to a reader rather than to a test.
   */
  it.each([
    ["daily", 24 * HOUR, false],
    ["six-hourly", 6 * HOUR, false],
    ["four-hourly", 4 * HOUR, false],
    ["hourly", HOUR, true],
    ["seven-hourly", 7 * HOUR, true],
    ["by the minute", 60 * 1000, true],
  ])("%s bars from a 05:00Z open: a midnight-UTC bar exists = %s", (_name, step, exists) => {
    const open = at("2026-03-02T05:00Z");
    const bars = Array.from({ length: Math.ceil((60 * DAY) / step) }, (_, i) => open + i * step);

    expect(bars.some((x) => x % DAY === 0)).toBe(exists);
  });

  /**
   * **The bug this exists for.** A New York session opens at 05:00Z, and
   * the `x % 86_400_000 === 0` anchor every example used to carry asks
   * about UTC midnight instead. On this tape — six-hourly bars from an
   * 05:00Z open — no bar's x is a multiple of a day, so it is true of
   * nothing and VWAP accumulates across every session forever. Move to
   * hourly bars from the same open and one lands on midnight UTC every
   * day, resetting mid-session instead. Whether a tape has such a bar at
   * all is an accident of its layout; neither failure announces itself.
   */
  it("fires where a UTC-midnight anchor never does on this cadence", () => {
    const newYork = periodAnchor({ barStart: sessionStart({ timeZone: "America/New_York" }) });
    // Midnight in New York, three days running, one bar every six hours.
    const bars = Array.from({ length: 12 }, (_, i) => ({
      x: at("2026-03-02T05:00Z") + i * 6 * HOUR,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
    const previous = (i: number): OHLC | null => (i === 0 ? null : bars[i - 1]);

    expect(bars.some((bar) => bar.x % DAY === 0)).toBe(false);
    expect(bars.filter((bar, i) => newYork(bar, i, previous(i)))).toHaveLength(3);
  });

  /**
   * A clock that moves does not open a session by itself: New York springs
   * forward at 07:00Z on 8 March 2026, in the middle of a session that
   * opened at 05:00Z.
   */
  it("does not open a session where a clock merely moved", () => {
    const newYork = periodAnchor({ barStart: sessionStart({ timeZone: "America/New_York" }) });
    const before = { x: at("2026-03-08T06:00Z"), open: 1, high: 1, low: 1, close: 1 };
    const after = { x: at("2026-03-08T08:00Z"), open: 1, high: 1, low: 1, close: 1 };

    expect(newYork(after, 1, before)).toBe(false);
  });

  /**
   * **Sub-millisecond precision carried as a fractional epoch millisecond
   * is a real thing**, and the data door lets that x through. Asking a
   * clock about it rather than the millisecond under it would throw here —
   * inside an indicator's recomputation, a long way from anything a
   * consumer could act on — and which session holds an instant does not
   * change within a millisecond.
   */
  it("reads a fraction of a millisecond as the millisecond it falls in", () => {
    const opens = periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) });
    const bar = (x: number): OHLC => ({ x, open: 1, high: 1, low: 1, close: 1 });
    const midnight = at("2026-03-02T00:00Z");

    expect(() => opens(bar(midnight + 0.5), 1, bar(midnight - 1))).not.toThrow();
    // Still the same session either side of the fraction.
    expect(opens(bar(midnight + 0.5), 1, bar(midnight))).toBe(false);
    // And still a new one across the boundary.
    expect(opens(bar(midnight + 0.5), 1, bar(midnight - 0.5))).toBe(true);
  });

  /**
   * **Below the epoch the fraction has to go down, not toward zero.** The
   * epoch itself is a UTC midnight, so half a millisecond before it belongs
   * to the day that ended there — truncating toward zero would file it
   * under the day that had not started yet.
   */
  it("takes a fraction below the epoch into the millisecond beneath it", () => {
    const opens = periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) });
    const bar = (x: number): OHLC => ({ x, open: 1, high: 1, low: 1, close: 1 });

    expect(opens(bar(-0.5), 1, bar(-1))).toBe(false);
    expect(opens(bar(-0.5), 1, bar(0))).toBe(true);
  });

  /**
   * **The same x meets the same door wherever it sits in the tape.** What
   * a session answers for stops three days short of the ends of what a
   * `Date` holds, so an x can be a perfectly good instant and still be
   * outside it — and refusing it only when there is a bar behind would
   * make the very same x pass as the first bar and throw as the second.
   */
  it("refuses an out-of-domain instant on the first bar too", () => {
    const opens = periodAnchor({ barStart: sessionStart({ timeZone: "Asia/Seoul" }) });
    // A good `Date`, and past the reach a session answers for.
    const edge: OHLC = { x: 8.64e15 - 3 * DAY + 1, open: 1, high: 1, low: 1, close: 1 };
    const later: OHLC = { x: edge.x + DAY, open: 1, high: 1, low: 1, close: 1 };

    expect(Number.isFinite(new Date(edge.x).getTime())).toBe(true);
    expect(() => opens(edge, 0, null)).toThrow(ContractError);
    expect(() => opens(later, 1, edge)).toThrow(ContractError);

    // And with a good bar behind it, so it is this bar being judged and
    // not the one before — the previous bar is asked about first.
    const good: OHLC = { x: at("2026-03-02T00:00Z"), open: 1, high: 1, low: 1, close: 1 };
    expect(() => opens(edge, 1, good)).toThrow(ContractError);
  });

  /**
   * **Which bar is asked about first decides how often the clock is read.**
   * `sessionStart` keeps one session, so asking about the bar behind first
   * leaves that slot holding the session this bar is in — which is the one
   * the next bar asks about. Asking about this bar first leaves the slot a
   * step behind, and a daily tape, where every bar opens its own session,
   * then misses twice per bar instead of once. Measured over 5,000 daily
   * bars: 25,216 reads this way against 50,427 the other, 70 ms against
   * 143.
   */
  it("reads the clock once per bar on a daily tape, not twice", () => {
    const reads = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const opens = periodAnchor({ barStart: sessionStart({ timeZone: "America/New_York" }) });
    const bars = Array.from({ length: 500 }, (_, i) => ({
      x: Date.UTC(2000, 0, 1) + i * DAY,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }));

    reads.mockClear();
    for (let i = 0; i < bars.length; i++) opens(bars[i], i, i === 0 ? null : bars[i - 1]);

    // A miss costs about five reads, so one per bar lands near 5N and two
    // near 10N. Seven is between them and nowhere near either.
    expect(reads.mock.calls.length).toBeLessThan(7 * bars.length);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a missing time zone", () => {
    const open = (given: unknown): unknown =>
      (periodAnchor as (given: unknown) => unknown)(given);

    for (const bad of [undefined, null, {}, { timeZone: "" }]) {
      expect(() => open(bad)).toThrow(ContractError);
    }
  });
});
