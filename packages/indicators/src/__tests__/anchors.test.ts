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
   * argument, every consumer would have to close over the array and index it
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
   * **The bug this exists for.** A New York session opens at 05:00Z, and
   * the `x % 86_400_000 === 0` anchor that reads as "daily" asks
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

  it("refuses options without a barStart function", () => {
    // Reflect.apply lets malformed options from plain-JavaScript callers past the type checker.
    const open = (given: unknown): unknown => Reflect.apply(periodAnchor, undefined, [given]);

    const bad = [undefined, null, {}, { timeZone: "UTC" }, { barStart: "UTC" }, { barStart: 0 }];
    for (const given of bad) {
      expect(() => open(given)).toThrow(ContractError);
    }
  });
});
