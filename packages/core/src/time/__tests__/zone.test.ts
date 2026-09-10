import { afterEach, describe, expect, it, vi } from "vitest";

import { ContractError } from "../../primitives";
import { Zone } from "../zone";

/** The reading a zone shows at that instant, as a compact string. */
function reading(zone: Zone, ms: number): string {
  const p = zone.parts(ms);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const MIDNIGHT = { hour: 0, minute: 0, second: 0 } as const;

/**
 * **A reading past the end of its month is the next month's.** `sessionStart`
 * asks for "the day after this one" by writing a day past the end of it, so
 * the encoder carrying that overflow is a contract, not a coincidence.
 */
/**
 * **A name that is not a zone is a plain mistake, and it deserves the same
 * words as any other.** It arrives from a saved chart or a settings pane,
 * and `Intl` answers it with a bare `RangeError` that names neither the
 * value nor who passed it — the very reason the reading door exists. The
 * axis builds this same object, so `timeTicks` gets the vocabulary too.
 */
describe("Zone — a name that is not a zone", () => {
  it.each(["Not/AZone", "", "utc/", "Asia/Seoul "])("refuses %o", (timeZone) => {
    expect(() => new Zone(timeZone)).toThrow(ContractError);
  });

  it("takes an alias the runtime still answers to", () => {
    // Not in `supportedValuesOf`, so a membership check would refuse it.
    expect(() => new Zone("Asia/Katmandu")).not.toThrow();
  });

  /**
   * **Only the mistake we recognise gets rewritten.** A bad name is the one
   * thing `Intl` reports here as a `RangeError`; anything else that went
   * wrong is not ours to relabel, and dressing it as a contract error would
   * send a reader looking at their own zone string for a fault that is
   * somewhere else entirely.
   */
  it("leaves an error it did not expect alone", () => {
    vi.spyOn(globalThis.Intl, "DateTimeFormat").mockImplementation(() => {
      throw new TypeError("something else went wrong");
    });

    expect(() => new Zone("UTC")).toThrow(TypeError);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

/**
 * **A jump that straddles a reading is not a jump that starts at it.**
 * Toronto's clocks went from the 30th's 23:30 to the 31st's 00:30 in 1919,
 * so that day's midnight sits *inside* the jump. Resolving it answers by
 * the length of the jump and lands after the day had already begun;
 * `firstFrom` answers the moment the clock landed, which is the day's
 * first instant. The two agree wherever a jump starts at the reading
 * asked about, which is every ordinary spring-forward.
 */
describe("Zone — the earliest instant at or after a reading", () => {
  it("answers where the clock landed when a jump straddles the reading", () => {
    const zone = new Zone("America/Toronto");
    const midnight = zone.localOf({
      year: 1919,
      month: 3,
      day: 31,
      hour: 0,
      minute: 0,
      second: 0,
    });

    expect(zone.firstFrom(midnight)).toBe(Date.parse("1919-03-31T04:30:00Z"));
    // Resolving the same reading lands after the day began.
    expect(zone.toUtc({ year: 1919, month: 3, day: 31, hour: 0, minute: 0, second: 0 }))
      .toBeGreaterThan(zone.firstFrom(midnight));
  });

  /**
   * **A reading is a whole second, so "at or after" rounds up to one.** A
   * clock is asked about seconds and no finer; a millisecond between two
   * of them names no reading, and the earliest one at or after it is the
   * next second rather than the one beneath. Leaving the remainder on
   * would also carry it into every offset sampled from there, which is how
   * asking about millisecond 1 once answered millisecond 2.
   */
  it.each([
    [0, 0],
    [1, 1000],
    [999, 1000],
    [1000, 1000],
    [1001, 2000],
    [-1500, -1000],
    // Smaller than a millisecond, and smaller than a division survives:
    // `5e-324 / 1000` underflows to zero, and rounding *that* up answers
    // before what was asked for. Whole milliseconds first, then seconds.
    [Number.MIN_VALUE, 1000],
    [1e-321, 1000],
    [0.5, 1000],
  ])("takes a reading of %sms to the whole second at or after it", (reading, instant) => {
    const at = new Zone("UTC").firstFrom(reading);

    expect(at).toBe(instant);
    expect(at).toBeGreaterThanOrEqual(reading);
  });

  /**
   * **The earliest, not merely an early one.** A reading a clock showed
   * twice qualifies at both instants, and checking only the second before
   * an answer cannot tell them apart: New York read 01:30 at 05:30Z and
   * again at 06:30Z on 3 November 2024, and a second before the later one
   * reads 01:29:59, which does not qualify. Both pass a local check; only
   * the earlier is the answer.
   */
  it("answers the first of two instants carrying the same reading", () => {
    const zone = new Zone("America/New_York");
    const reading = zone.localOf({
      year: 2024,
      month: 11,
      day: 3,
      hour: 1,
      minute: 30,
      second: 0,
    });

    expect(zone.firstFrom(reading)).toBe(Date.parse("2024-11-03T05:30:00Z"));
  });

  it("agrees with resolving where a jump starts at the reading", () => {
    const zone = new Zone("America/Santiago");
    const date = { year: 2024, month: 9, day: 8, hour: 0, minute: 0, second: 0 };

    expect(zone.firstFrom(zone.localOf(date))).toBe(zone.toUtc(date));
  });
});

describe("Zone — a day past the end of a month", () => {
  it.each([
    [{ year: 2026, month: 1, day: 32 }, "2026-02-01"],
    [{ year: 2026, month: 2, day: 29 }, "2026-03-01"],
    [{ year: 2026, month: 12, day: 32 }, "2027-01-01"],
    [{ year: 4, month: 2, day: 30 }, "0004-03-01"],
  ])("carries %o into the next month", (date, expected) => {
    const zone = new Zone("UTC");
    const parts = zone.parts(zone.toUtc({ ...date, hour: 0, minute: 0, second: 0 }));
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");

    expect(`${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`).toBe(expected);
  });
});

describe("Zone", () => {
  it("reads a wall clock and writes it back on an ordinary day", () => {
    const zone = new Zone("Asia/Seoul");
    const ms = Date.UTC(2026, 8, 8, 3, 0, 0); // 12:00 KST

    expect(reading(zone, ms)).toBe("2026-09-08 12:00");
    expect(zone.toUtc(zone.parts(ms))).toBe(ms);
    expect(zone.localOf(zone.parts(ms)) - ms).toBe(9 * 60 * 60 * 1000);
  });

  describe("a wall clock that does not exist", () => {
    /**
     * These three zones jump their clocks **at midnight**, so the day's
     * first reading is one the zone never shows. Answering the day before's
     * 23:00 — which is what a fixed-point correction settles on — puts a
     * bar, and every drawing anchored to it, one day off.
     */
    const skippedMidnights: ReadonlyArray<[string, number, number, number, string]> = [
      ["America/Santiago", 2024, 9, 8, "2024-09-08 01:00"],
      ["America/Havana", 2024, 3, 10, "2024-03-10 01:00"],
      ["America/Sao_Paulo", 2018, 11, 4, "2018-11-04 01:00"],
    ];

    it.each(skippedMidnights)(
      "%s %i-%i-%i answers the day's first real moment",
      (timeZone, year, month, day, expected) => {
        const zone = new Zone(timeZone);

        const ms = zone.toUtc({ year, month, day, ...MIDNIGHT });

        expect(reading(zone, ms)).toBe(expected);
      },
    );

    it("answers an instant that is inside the day it was asked for", () => {
      const zone = new Zone("America/Santiago");

      const ms = zone.toUtc({ year: 2024, month: 9, day: 8, ...MIDNIGHT });

      expect(zone.parts(ms).day).toBe(8);
    });

    it("answers the next day when a whole day never happened", () => {
      // Samoa crossed the date line at the end of 2011: the 30th of December
      // is a day that country never had. Its first real moment is the 31st.
      const zone = new Zone("Pacific/Apia");

      const ms = zone.toUtc({ year: 2011, month: 12, day: 30, ...MIDNIGHT });

      expect(reading(zone, ms)).toBe("2011-12-31 00:00");
    });

    it("resolves a jump that is not daylight saving at all", () => {
      // Seoul moved its standard offset by half an hour at midnight in 1961.
      // The rule is about clocks that jump, not about summer time.
      const zone = new Zone("Asia/Seoul");

      const ms = zone.toUtc({ year: 1961, month: 8, day: 10, ...MIDNIGHT });

      expect(reading(zone, ms)).toBe("1961-08-10 00:30");
    });

    it("carries a skipped reading past a half-hour jump", () => {
      // Lord Howe moves by thirty minutes: 02:00 becomes 02:30, so the
      // readings in between are ones the island never shows.
      const zone = new Zone("Australia/Lord_Howe");

      const start = zone.toUtc({ year: 2024, month: 10, day: 6, hour: 2, minute: 0, second: 0 });
      const inside = zone.toUtc({ year: 2024, month: 10, day: 6, hour: 2, minute: 15, second: 0 });

      expect(reading(zone, start)).toBe("2024-10-06 02:30");
      expect(reading(zone, inside)).toBe("2024-10-06 02:45");
    });

    it("resolves forward for a jump that is not at midnight", () => {
      // New York jumps at 02:00; that hour's readings never happen.
      const zone = new Zone("America/New_York");

      const ms = zone.toUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 0, second: 0 });

      expect(reading(zone, ms)).toBe("2026-03-08 03:00");
    });
  });

  describe("a wall clock that happens twice", () => {
    it("answers the first of the two", () => {
      // Havana falls back at 01:00 → 00:00, so 00:30 happens twice.
      const zone = new Zone("America/Havana");
      const parts = { year: 2024, month: 11, day: 3, hour: 0, minute: 30, second: 0 };

      const ms = zone.toUtc(parts);

      expect(reading(zone, ms)).toBe("2024-11-03 00:30");
      // The other one is an hour later and reads the same.
      expect(reading(zone, ms + 60 * 60 * 1000)).toBe("2024-11-03 00:30");
      expect(zone.toUtc(parts)).toBe(ms);
    });

    it("answers the first of two readings half an hour apart", () => {
      const zone = new Zone("Australia/Lord_Howe");
      const parts = { year: 2024, month: 4, day: 7, hour: 1, minute: 45, second: 0 };

      const ms = zone.toUtc(parts);

      expect(reading(zone, ms)).toBe("2024-04-07 01:45");
      expect(reading(zone, ms + 30 * 60 * 1000)).toBe("2024-04-07 01:45");
    });

    it("answers the first midnight of a day that starts twice", () => {
      const zone = new Zone("America/Havana");

      const ms = zone.toUtc({ year: 2024, month: 11, day: 3, ...MIDNIGHT });

      expect(reading(zone, ms)).toBe("2024-11-03 00:00");
      expect(reading(zone, ms - 1)).toBe("2024-11-02 23:59");
    });
  });

  describe("the day's first moment is idempotent", () => {
    /**
     * The law a bar start rests on: the start of the day an instant belongs
     * to is itself the start of its own day. A zone that answers the wrong
     * side of a transition breaks it, and then the same tick can land in two
     * different bars.
     */
    const zones = [
      "UTC",
      "Asia/Seoul",
      "America/New_York",
      "America/Santiago",
      "America/Havana",
      "America/Sao_Paulo",
      "Europe/Berlin",
      "Australia/Lord_Howe", // a 30-minute shift
    ];

    it.each(zones)("holds across a year of %s", (timeZone) => {
      const zone = new Zone(timeZone);
      const dayStart = (ms: number): number =>
        zone.toUtc({ ...zone.parts(ms), ...MIDNIGHT });

      let previous = Number.NEGATIVE_INFINITY;
      for (let day = 0; day < 365; day++) {
        const noonish = Date.UTC(2024, 0, 1, 12, 0, 0) + day * 24 * 60 * 60 * 1000;
        const start = dayStart(noonish);

        expect(dayStart(start)).toBe(start);
        expect(start).toBeLessThanOrEqual(noonish);
        expect(start).toBeGreaterThan(previous);
        previous = start;
      }
    });
  });

  describe("what it refuses", () => {
    /**
     * A bar's x reaches a zone through its session's start, and a feed that
     * hands over microseconds instead of milliseconds is an ordinary
     * mistake. `Intl` answers that with a bare `RangeError` naming nothing.
     */
    it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.77e18, -1.77e18])(
      "refuses %p, naming it",
      (ms) => {
        const zone = new Zone("UTC");

        expect(() => zone.parts(ms)).toThrow(/can only read an instant a Date can hold/);
      },
    );

    it("still answers at the very edge of time", () => {
      // The last instant a Date holds. Looking a day either side of it, as
      // the rule does, would fall off the end.
      const zone = new Zone("America/New_York");
      const edge = 8.64e15;

      expect(() => zone.parts(edge)).not.toThrow();
      expect(zone.toUtc(zone.parts(edge - 60_000))).toBe(edge - 60_000);
    });
  });

  describe("the axis it cuts into runs", () => {
    /**
     * A run says a reading and its instant differ by a fixed amount, and a
     * caller does arithmetic on that. A clock shows seconds, so the amount
     * is a whole number of them — read it at a fractional millisecond and
     * the fraction rides along, putting every instant the run names off the
     * second by the same sliver.
     */
    it("keeps its arithmetic on whole seconds however it was asked", () => {
      const zone = new Zone("America/New_York");
      const at = Date.UTC(2026, 8, 8);

      const whole = zone.runs(at, at + 300_000);
      const fractional = zone.runs(at + 0.659, at + 300_000.659);

      expect(fractional.map((run) => run.offset)).toEqual(whole.map((run) => run.offset));
      expect(Math.abs(whole[0].offset % 1000)).toBe(0);
    });

    it("claims nothing about readings it did not look at", () => {
      // A summer-only question must not answer for winter.
      const zone = new Zone("America/New_York");
      const july = Date.UTC(2026, 6, 1);

      const runs = zone.runs(july, july + 60 * 60 * 1000);

      expect(runs).toHaveLength(1);
      expect(runs[0].from).toBeGreaterThan(Date.UTC(2026, 5, 1));
      expect(runs[0].to).toBeLessThan(Date.UTC(2026, 7, 1));
    });

    it("never answers with a run that runs backwards", () => {
      // A query that ends inside the hour a clock repeated: its end reading
      // names the earlier of the two instants, which is behind where the
      // last run starts.
      const zone = new Zone("America/New_York");
      const fall = Date.parse("2026-11-01T06:00:00Z");

      const runs = zone.runs(fall - 10 * 60 * 1000, fall + 10 * 60 * 1000);

      for (const run of runs) {
        expect(run.to).toBeGreaterThanOrEqual(run.from);
      }
    });

    it("leaves the readings a forward move skipped between two runs", () => {
      const zone = new Zone("America/New_York");
      const spring = Date.parse("2026-03-08T07:00:00Z");
      const HOUR = 60 * 60 * 1000;

      const runs = zone.runs(spring - 3 * HOUR, spring + 3 * HOUR);

      expect(runs).toHaveLength(2);
      expect(runs[0].offset).toBe(-5 * HOUR);
      expect(runs[1].offset).toBe(-4 * HOUR);
      // The clock last showed 02:00 and next showed 03:00; the hour between
      // is one it never showed, and it belongs to neither run.
      expect(runs[0].to).toBe(spring - 5 * HOUR);
      expect(runs[1].from).toBe(spring - 4 * HOUR);
      // Where it landed, for whoever has to answer for that hour.
      expect(runs[1].from - runs[1].offset).toBe(spring);
    });

    it("lets two runs meet where a backward move repeated readings", () => {
      const zone = new Zone("America/New_York");
      const fall = Date.parse("2026-11-01T06:00:00Z");
      const HOUR = 60 * 60 * 1000;

      const runs = zone.runs(fall - 3 * HOUR, fall + 3 * HOUR);

      expect(runs).toHaveLength(2);
      // Nothing was skipped, so there is nothing between them — and the
      // repeated hour belongs to the run before, its first turn.
      expect(runs[1].from).toBe(runs[0].to);
      expect(runs[0].to).toBe(fall - 4 * HOUR);
    });
  });

  it("counts years on one line through the eras", () => {
    /**
     * `Intl` names years within an era — it calls the year before AD 1
     * "1 BC", and the one before that "2 BC". Everything here is
     * arithmetic, so the years are read onto a single line instead: 1 BC
     * is year 0, 2 BC is year −1. Read them the other way and the year
     * before AD 1 answers as AD 1.
     */
    const zone = new Zone("UTC");
    const yearZero = new Date(0);
    yearZero.setUTCFullYear(0, 0, 1);
    yearZero.setUTCHours(0, 0, 0, 0);
    const yearBefore = new Date(0);
    yearBefore.setUTCFullYear(-1, 5, 15);
    yearBefore.setUTCHours(12, 0, 0, 0);

    expect(zone.parts(yearZero.getTime()).year).toBe(0);
    expect(zone.parts(yearBefore.getTime()).year).toBe(-1);
    expect(zone.toUtc(zone.parts(yearZero.getTime()))).toBe(yearZero.getTime());
    expect(zone.toUtc(zone.parts(yearBefore.getTime()))).toBe(yearBefore.getTime());
  });

  it("keeps reading and writing in step", () => {
    const zone = new Zone("America/New_York");
    const ms = Date.UTC(2026, 5, 1, 16, 30, 0);

    expect(zone.toUtc(zone.parts(ms))).toBe(ms);
  });
});

describe("the zone database the rule rests on", () => {
  /**
   * Two facts about the installed database hold the rules up. Resolving a
   * reading looks one day either side of it and takes the offsets it finds
   * as the only two in play; cutting the axis into runs looks every five
   * days and takes two equal looks as proof of no move between them. So a
   * move must be at most a day — Samoa's date-line move in 2011 is exactly
   * that — and two must stand more than five days apart, where the
   * tightest pair from 1900 to 2035 is 167 hours, an hour under seven days
   * (America/Boa_Vista, October 2000). The range matters: this used to
   * start at 1970 while the reader it holds up claimed 1900, and the gap
   * between the two is where Toronto's 1919 clocks sat.
   *
   * This is a sample, not a proof: twelve zones, the ones that move most or
   * most strangely. It would catch an upgrade that changed one of those,
   * and would not catch one that gave a thirteenth zone two moves in a
   * week. Asked of `Intl` directly rather than through `Zone`, because the
   * claim is about the data and not about what we do with it.
   */
  const DAY = 24 * 60 * 60 * 1000;
  const FROM = Date.UTC(1900, 0, 1);
  const DAYS = 136 * 366;

  function movesOf(timeZone: string): Array<{ at: number; by: number }> {
    const format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const offsetAt = (ms: number): number => {
      const read: Record<string, number> = {};
      for (const { type, value } of format.formatToParts(ms)) {
        if (type !== "literal") read[type] = Number(value);
      }
      const wall = Date.UTC(
        read.year,
        read.month - 1,
        read.day,
        read.hour === 24 ? 0 : read.hour,
        read.minute,
        read.second,
      );
      return wall - ms;
    };

    const moves: Array<{ at: number; by: number }> = [];
    let previous = offsetAt(FROM);
    for (let day = 1; day < DAYS; day++) {
      const probe = FROM + day * DAY;
      const offset = offsetAt(probe);
      if (offset === previous) continue;
      moves.push({ at: probe, by: Math.abs(offset - previous) });
      previous = offset;
    }
    return moves;
  }

  it("moves clocks by less than a day, and never twice within five", { timeout: 20_000 }, () => {
    // A sample rather than all of them — the zones that move most, or
    // most strangely. Walking every zone a day at a time would be minutes
    // of gate for the same two facts.
    const zones = [
      "Pacific/Apia",
      "Pacific/Kwajalein",
      "America/Santiago",
      "America/Havana",
      "America/Sao_Paulo",
      "Asia/Tehran",
      "Australia/Lord_Howe",
      "Africa/Cairo",
      "America/New_York",
      "Europe/Berlin",
      "Asia/Beirut",
      "Africa/Casablanca",
    ];

    let seen = 0;
    for (const timeZone of zones) {
      const moves = movesOf(timeZone);
      seen += moves.length;
      for (const move of moves) {
        expect(move.by).toBeLessThanOrEqual(DAY);
      }
      // Samoa's is the one that reaches the limit; without it the sample
      // would not be exercising the bound it asserts.
      if (timeZone === "Pacific/Apia") {
        expect(moves.some((move) => move.by === DAY)).toBe(true);
      }
      for (let i = 1; i < moves.length; i++) {
        expect(moves[i].at - moves[i - 1].at).toBeGreaterThan(5 * DAY);
      }
    }
    // The sweep is worth nothing if it found no moves to check.
    expect(seen).toBeGreaterThan(500);
  });
});
