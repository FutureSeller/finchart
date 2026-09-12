import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractError } from "../../primitives";
import { DEFAULT_X_FORMAT } from "../format";
import { timeTicks } from "../time-ticks";
import type { TickStrategyContext } from "../types";

const UTC = { timeZone: "UTC", locale: "en-US" };

/** Context for a continuous coordinate system (domain = data x = ms). */
function context(
  minMs: number,
  maxMs: number,
  span = 800,
  minTickSpacing = 80,
): TickStrategyContext {
  return {
    min: minMs,
    max: maxMs,
    span,
    minTickSpacing,
    xOf: (value) => value,
    domainOf: (x) => x,
    positionOf: (value) => ((value - minMs) / (maxMs - minMs)) * span,
  };
}

const ms = (iso: string) => Date.parse(iso);

/**
 * **A zone name that is not one is refused here too.** The strategy builds
 * the same reader the session arithmetic does, so a name out of a saved
 * chart or a settings pane fails in the library's own vocabulary rather
 * than as a bare `RangeError` from `Intl` naming nothing.
 */
describe("timeTicks — a name that is not a zone", () => {
  it.each(["Not/AZone", "Seoul", "utc/"])("refuses %o", (timeZone) => {
    expect(() => timeTicks({ timeZone })).toThrow(ContractError);
  });

  it("still takes the runtime's own zone when none is given", () => {
    expect(() => timeTicks()).not.toThrow();
  });
});

describe("timeTicks — boundary snapping", () => {
  it("should land on local midnights for a multi-day window", () => {
    const ticks = timeTicks(UTC).ticks(
      context(ms("2026-03-02T07:00Z"), ms("2026-03-08T20:00Z")),
    );

    // All of them are midnights — not multiples of the data's start time.
    for (const tick of ticks) {
      expect(tick.value % (24 * 3600 * 1000)).toBe(0);
    }
    expect(ticks[0].value).toBe(ms("2026-03-03T00:00Z"));
  });

  it("should promote month and year starts", () => {
    const ticks = timeTicks(UTC).ticks(
      context(ms("2025-12-28T00:00Z"), ms("2026-01-03T00:00Z")),
    );
    const labels = ticks.map((tick) => tick.label);

    // Jan 1 is promoted to a year, not a month.
    expect(labels).toContain("2026");
    expect(labels).not.toContain("Jan");
    // The other midnights are month/day.
    expect(labels).toContain("12/29");
  });

  it("should walk calendar months where fixed steps are too dense", () => {
    const ticks = timeTicks(UTC).ticks(
      context(ms("2026-01-15T00:00Z"), ms("2026-07-15T00:00Z")),
    );

    const labels = ticks.map((tick) => tick.label);
    expect(labels).toEqual(["Feb", "Mar", "Apr", "May", "Jun", "Jul"]);
  });

  it("should fall back to intra-day times with promotion at midnight", () => {
    const ticks = timeTicks(UTC).ticks(
      context(ms("2026-03-04T18:00Z"), ms("2026-03-05T12:00Z")),
    );

    const labels = ticks.map((tick) => tick.label);
    expect(labels).toContain("21:00");
    // A midnight tick is promoted to a date instead of a time.
    expect(labels).toContain("3/5");
  });
});

describe("timeTicks — time zone and locale", () => {
  it("should put midnight where the zone says", () => {
    const day = context(ms("2026-03-02T00:00Z"), ms("2026-03-09T00:00Z"));

    const seoul = timeTicks({ timeZone: "Asia/Seoul" }).ticks(day);
    const utc = timeTicks(UTC).ticks(day);

    // Seoul midnight is UTC 15:00 — the two zones' tick positions are
    // 9 hours apart.
    expect(seoul[0].value % (24 * 3600 * 1000)).toBe(15 * 3600 * 1000);
    expect(utc[0].value % (24 * 3600 * 1000)).toBe(0);
  });

  it("should speak the locale", () => {
    const ticks = timeTicks({ timeZone: "UTC", locale: "ko" }).ticks(
      context(ms("2026-01-15T00:00Z"), ms("2026-07-15T00:00Z")),
    );

    expect(ticks.map((tick) => tick.label)).toContain("3월");
  });
});

describe("timeTicks — a different x unit", () => {
  it("should convert through epochOf/xOfEpoch", () => {
    // x = days since 2026-01-05 (the coordinate system used by examples).
    const base = ms("2026-01-05T00:00Z");
    const strategy = timeTicks({
      ...UTC,
      epochOf: (days) => base + days * 24 * 3600 * 1000,
      xOfEpoch: (at) => (at - base) / (24 * 3600 * 1000),
    });

    const ticks = strategy.ticks({
      min: 0,
      max: 60,
      span: 800,
      minTickSpacing: 80,
      xOf: (value) => value,
      domainOf: (x) => x,
      positionOf: (value) => (value / 60) * 800,
    });

    // The values are back in the day-count coordinate system — weekly
    // integer spacing.
    expect(ticks.length).toBeGreaterThan(4);
    expect(ticks.every((tick) => Number.isInteger(tick.value))).toBe(true);
    expect(ticks.map((t) => t.label)).toContain("Feb");
  });
});

describe("timeTicks — edge cases", () => {
  it("should return nothing for a degenerate window", () => {
    expect(timeTicks(UTC).ticks(context(5, 5))).toEqual([]);
  });

  it("should spread multi-year windows on the 1-2-5 year ladder", () => {
    const ticks = timeTicks(UTC).ticks(
      context(ms("1990-06-01T00:00Z"), ms("2026-06-01T00:00Z")),
    );

    const labels = ticks.map((tick) => tick.label);
    // 36 years / 800px → a 5-year stride.
    expect(labels).toContain("1995");
    expect(labels).toContain("2000");
    expect(labels).not.toContain("1996");
  });
});

describe("timeTicks — a day whose midnight the clock skipped", () => {
  /**
   * Santiago moves its clocks at midnight, so 2024-09-08 00:00 is a reading
   * that never happens there. A boundary that settles on the reading before
   * it puts the day's tick at 23:00 the evening before — the label reads one
   * day, the tick stands under the other.
   */
  const santiago = { timeZone: "America/Santiago", locale: "en-US" };

  it("puts the day's tick inside the day it labels", () => {
    const strategy = timeTicks(santiago);
    const zoned = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });

    const ticks = strategy.ticks(
      context(ms("2024-09-05T12:00Z"), ms("2024-09-11T12:00Z")),
    );

    const readings = ticks.map((tick) => zoned.format(tick.value));

    // The day whose midnight was skipped gets its first real moment, 01:00 —
    // and it stands inside 09/08, not at 23:00 on 09/07.
    expect(readings).toContain("09/08/2024, 01");
    expect(readings.filter((reading) => reading.endsWith(", 23"))).toEqual([]);
    // Every other day still starts at midnight.
    expect(readings).toContain("09/07/2024, 00");
    expect(readings).toContain("09/09/2024, 00");
  });

  it("does not place two ticks on the same instant", () => {
    const ticks = timeTicks(santiago).ticks(
      context(ms("2024-09-07T00:00Z"), ms("2024-09-09T12:00Z")),
    );

    const values = ticks.map((tick) => tick.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("timeTicks — a grid that walks over a jump", () => {
  /**
   * The wall-clock grid asks for readings the clock skipped, and those
   * answer the instant it landed on — the same instants the grid asks for
   * again a step later. Left alone the axis draws them twice, the second
   * set standing to the left of the first.
   */
  it("keeps each instant once and in order across a spring-forward hour", () => {
    const ticks = timeTicks({ timeZone: "America/New_York", locale: "en-US" }).ticks(
      context(ms("2026-03-08T06:00Z"), ms("2026-03-08T09:00Z"), 1200, 60),
    );

    const values = ticks.map((tick) => tick.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it("draws one tick for a day the calendar skipped entirely", () => {
    // Samoa jumped from 2011-12-29 straight to 2011-12-31.
    const ticks = timeTicks({ timeZone: "Pacific/Apia", locale: "en-US" }).ticks(
      context(ms("2011-12-28T00:00Z"), ms("2012-01-02T00:00Z"), 500, 100),
    );

    const days = ticks.map((tick) =>
      new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Apia", day: "2-digit" })
        .format(tick.value),
    );
    expect(new Set(days).size).toBe(days.length);
    expect(days).not.toContain("30");
  });
});

describe("timeTicks — the grid's phase after a skipped reading", () => {
  /**
   * The anchor is a reading. Resolving it to an instant first lets a
   * skipped midnight set the phase for every day that follows — the window
   * would read 01:00 all week instead of only on the day the clock passed
   * over midnight.
   */
  it("returns to midnight on the days after the one that lost it", () => {
    const zoned = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    const ticks = timeTicks({ timeZone: "America/Santiago", locale: "en-US" }).ticks(
      context(ms("2024-09-08T12:00Z"), ms("2024-09-12T12:00Z"), 500, 100),
    );

    expect(ticks.map((tick) => zoned.format(tick.value))).toEqual([
      "09/09, 00:00",
      "09/10, 00:00",
      "09/11, 00:00",
      "09/12, 00:00",
    ]);
  });

  it("says nothing about a skipped stretch no grid reading falls in", () => {
    /**
     * Cairo moved its clock on a Friday night in April 2023. A weekly grid
     * stands on Mondays, so none of its readings is one that night
     * swallowed — and a mark for the moment the clock landed would put a
     * Friday in a row of Mondays. It would not be crowded out either: four
     * days behind the Monday before it and nearly three ahead of the next.
     */
    const zoned = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    const ticks = timeTicks({ timeZone: "Africa/Cairo", locale: "en-US" }).ticks(
      context(ms("2023-04-17T00:00Z"), ms("2023-05-08T00:00Z"), 800, 100),
    );

    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) {
      expect(zoned.format(tick.value)).toBe("Mon 00:00");
    }
  });

  it("keeps a weekly grid on Monday midnight when that Monday lost it", () => {
    // Tehran skipped Monday's midnight on 2021-03-22.
    const zoned = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    const ticks = timeTicks({ timeZone: "Asia/Tehran", locale: "en-US" }).ticks(
      context(ms("2021-03-22T12:00Z"), ms("2021-04-25T12:00Z"), 800, 100),
    );

    for (const tick of ticks) {
      expect(zoned.format(tick.value)).toBe("Mon 00:00");
    }
    expect(ticks.length).toBeGreaterThan(2);
  });
});

describe("timeTicks — where the grid stops", () => {
  /**
   * Monrovia moved its standard offset by 44 minutes and 30 seconds on the
   * 7th of January 1972, and that morning's readings up to 00:44:30 are
   * ones the country never showed. Answering each of them would put nine
   * ticks that never happened where the nine real ones belong.
   */
  it("gives a skipped stretch no more than the real grid after it", () => {
    const ticks = timeTicks({ timeZone: "Africa/Monrovia", locale: "en-US" }).ticks(
      context(
        ms("1972-01-06T22:33:45.659Z"),
        ms("1972-01-07T01:13:45.659Z"),
        800,
        25,
      ),
    );

    const values = ticks.map((tick) => tick.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);

    // Before the move the grid sits half a minute off the clock; after it,
    // on whole five minutes. The clock resumes half a minute before the grid
    // does, so a mark for the skipped stretch would stand right against the
    // grid's own first tick — it gives way, and every tick past the move is
    // on the grid.
    const seconds = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Monrovia",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (const value of values.filter((v) => v >= ms("1972-01-07T00:44:30Z"))) {
      expect(seconds.format(value)).toMatch(/[05]:00$/);
    }
    expect(seconds.format(values.at(-1))).toBe("10:00");

    // And nothing is crowded: the window asked for five minutes a tick.
    const spacing = values.slice(1).map((value, i) => value - values[i]);
    expect(Math.min(...spacing)).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});

/**
 * **A window's bounds are whole milliseconds before any arithmetic sees
 * them.** A fraction on a bound names an instant no tick can sit on, and
 * carrying it through the grid loses it — added to an offset, subtracted
 * from an anchor, divided by a step, and a small enough one stops existing
 * at any of the three. `[5e-324, 2000]` drew a tick at 0, outside the very
 * window it was asked about.
 */
describe("timeTicks — a window whose edge is not a whole millisecond", () => {
  it.each([
    ["UTC", 5e-324, 2000],
    ["UTC", -2000, -1e-9],
    ["Asia/Kolkata", 1e-9, 2000],
    ["America/New_York", 0.5, 3000.5],
  ])("draws nothing outside %s [%s, %s]", (timeZone, min, max) => {
    const ticks = timeTicks({ timeZone, locale: "en-US" }).ticks(
      context(min, max, 200, 50),
    );

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.value).toBeGreaterThanOrEqual(min);
      expect(tick.value).toBeLessThanOrEqual(max);
    }
  });

  /**
   * **The window a tick may stand in is not the window a pixel is measured
   * against.** Bringing the edges in to whole milliseconds is right for
   * deciding where a tick may sit and wrong for everything else: measuring
   * pixels against the narrowed one hands the whole span to fewer
   * milliseconds and quietly shrinks the distance the caller asked for,
   * and testing emptiness against it throws away a window that holds
   * exactly one instant.
   */
  it("keeps a window holding a single whole millisecond", () => {
    expect(
      timeTicks(UTC).ticks(context(999.5, 1000.5, 100, 50)).map((tick) => tick.value),
    ).toEqual([1000]);
    expect(
      timeTicks(UTC).ticks(context(-0.5, 0.5, 100, 50)).map((tick) => tick.value),
    ).toEqual([0]);
  });

  /**
   * **Narrowing decides where a tick may stand, not where the grid hangs
   * from.** A window whose edge sits half a millisecond before a midnight
   * belongs to the day before it; rounding that edge up to the midnight
   * moves the day the grid is anchored on, and a two-day rung then draws
   * the odd days where it drew the even ones. Nothing about which instants
   * are drawable changed — the whole phase did.
   */
  it("hangs the grid off the day the caller's window starts in", () => {
    const min = Date.UTC(2026, 0, 2) - 0.5;
    const ticks = timeTicks(UTC).ticks(context(min, min + 10 * 24 * 60 * 60 * 1000, 500, 100));

    expect(ticks.map((tick) => new Date(tick.value).getUTCDate())).toEqual([3, 5, 7, 9, 11]);
  });

  /**
   * **A clock read through `Date` truncates toward zero, not down.** A
   * window opening half a millisecond before the epoch belongs to the day
   * that ended there; reading it as the day after moves the grid's whole
   * phase, the same way narrowing the edge did.
   */
  it("hangs the grid off the day a window before the epoch starts in", () => {
    const ticks = timeTicks(UTC).ticks(context(-0.5, 863_999_999.5, 500, 100));

    expect(ticks.map((tick) => new Date(tick.value).getUTCDate())).toEqual([2, 4, 6, 8, 10]);
  });

  /**
   * **The month ladder asks only about months a zone can read.** Aligning
   * walks back within the year, and at the earliest instants a `Date`
   * holds there is nothing behind to walk into — its first instant falls
   * in an April, so that April is half outside and March wholly so.
   * Asking anyway threw where the axis had drawn nothing before.
   */
  it.each([
    ["earliest", -8.64e15, -8.64e15 + 100 * 24 * 60 * 60 * 1000],
    // The same walk at the other end: the loop asks about a month before
    // it learns the month is past the window, so the one after the last
    // was asked about too — and up there it cannot be read.
    ["latest", 8.64e15 - 100 * 24 * 60 * 60 * 1000, 8.64e15],
  ])("draws months at the %s instants a Date holds", (_end, min, max) => {
    const ticks = timeTicks(UTC).ticks(context(min, max, 800, 100));

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.value).toBeGreaterThanOrEqual(min);
      expect(tick.value).toBeLessThanOrEqual(max);
    }
  });

  /**
   * **A local calendar reading can go backwards.** Goose Bay entered
   * November at 2009-11-01T03:00Z and rolled back into October a minute
   * later; Phoenix entered 1944 at 06:00Z and returned to 1943 at 06:01Z.
   * So the month or year a window's last instant *reads* is not the last
   * one the window reached, and stopping a calendar walk on that reading
   * drops a boundary that already happened. What a `Date` can hold is the
   * bound instead: a fact about `Date`, true whatever a clock does.
   */
  it.each([
    ["America/Goose_Bay", "2009-10-01T00:00Z", "2009-11-01T03:30Z", 300, 2],
    ["America/Phoenix", "1943-01-01T00:00Z", "1944-01-01T06:30Z", 500, 2],
    ["America/Phoenix", "1943-07-01T00:00Z", "1944-01-01T06:30Z", 200, 3],
  ])(
    "keeps a boundary a clock rolled back over in %s",
    (timeZone, from, to, spacing, expected) => {
      const ticks = timeTicks({ timeZone, locale: "en-US" }).ticks(
        context(ms(from), ms(to), 800, spacing),
      );

      expect(ticks).toHaveLength(expected);
    },
  );

  it("measures the spacing against the window it was given", () => {
    const min = -0.5;
    const max = 2000.5;
    const ticks = timeTicks(UTC).ticks(context(min, max, 100, 50));
    const pixels = (value: number) => ((value - min) / (max - min)) * 100;

    for (let i = 1; i < ticks.length; i++) {
      expect(pixels(ticks[i].value) - pixels(ticks[i - 1].value)).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("timeTicks — a window with nothing but a skipped stretch in it", () => {
  /**
   * Algiers moved its clock at midnight on the 1st of May 1981. Six hours
   * of that night hold one grid boundary, and it is one the clock skipped,
   * so the only thing the window can say is where the clock landed. Judging
   * that mark against a grid point outside the window — one that will never
   * be drawn — leaves the axis blank.
   */
  it("still says where the clock landed", () => {
    const ticks = timeTicks({ timeZone: "Africa/Algiers", locale: "en-US" }).ticks(
      context(ms("1981-04-30T21:48:45.659Z"), ms("1981-05-01T03:48:45.659Z"), 800, 700),
    );

    expect(ticks.map((tick) => tick.value)).toEqual([ms("1981-05-01T00:00:00Z")]);

    // **And it reads as the moment, not as the boundary it stands for.**
    // The clock landed on 01:00, so that is what the mark says. Calling it
    // "May 1" would name a midnight the clock never showed, at a place on
    // the axis an hour away from it.
    expect(ticks.map((tick) => tick.label)).toEqual(["01:00"]);
  });
});

describe("timeTicks — how close a pair may sit", () => {
  /**
   * **The step is picked by a name, and the name is approximate.** A day
   * that loses an hour is 23/24 of one, February is 28/30 of the month the
   * ladder has to call thirty days, and where a clock jumped by hours two
   * neighbouring boundaries can stand a third of a step apart. So the
   * spacing is enforced where the ticks come out, not assumed from the
   * step, and these are the windows that put a request right at a step's
   * nominal length — the only place the difference shows.
   */
  it("never draws a pair closer than what was asked", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const zones = [
      "UTC",
      "America/New_York",
      "Europe/Berlin",
      "Asia/Seoul",
      "America/Santiago",
      "Australia/Lord_Howe",
    ];
    // Each shape pins minStepMs onto a rung of the ladder: 3h, 12h, a day,
    // two days, a week, a month.
    const shapes = [
      [1, 800, 100],
      [3, 600, 100],
      [3, 300, 100],
      [6, 300, 100],
      [21, 300, 100],
      [90, 900, 300],
    ] as const;

    let closest = Number.POSITIVE_INFINITY;
    for (const timeZone of zones) {
      for (const [days, span, minTickSpacing] of shapes) {
        for (let start = 0; start < 365; start += 13) {
          const min = Date.UTC(2026, 0, 1) + start * DAY_MS;
          const max = min + days * DAY_MS;
          const ticks = timeTicks({ timeZone, locale: "en-US" }).ticks(
            context(min, max, span, minTickSpacing),
          );
          // In milliseconds, where the floor is enforced — the round trip
          // through pixels loses the last bit of an exactly-met gap.
          const minStepMs = (minTickSpacing * (max - min)) / span;
          for (let i = 1; i < ticks.length; i++) {
            const gap = ticks[i].value - ticks[i - 1].value;
            closest = Math.min(closest, gap / minStepMs);
          }
        }
      }
    }

    expect(closest).toBeGreaterThanOrEqual(1);
  });

  /**
   * **A clock that jumps forward eats part of the step it jumped over.**
   * The whole of Apia's 30 December 2011 never happened, so the Mondays
   * either side of it are six days apart on a seven-day step; Casey's
   * three-hour advance leaves a 21-hour day; Troll's two-hour advance
   * leaves one hour between two three-hour boundaries, the worst of the
   * installed database. Each is a real pair of calendar boundaries, not a
   * mark for a reading the clock skipped, so only the enforced floor
   * removes them.
   */
  it.each([
    ["Pacific/Apia", "2011-12-19T00:00Z", "2012-01-09T00:00Z", 300, 100],
    ["Antarctica/Casey", "2018-10-05T00:00Z", "2018-10-10T00:00Z", 500, 99],
    ["Antarctica/Troll", "2005-03-26T15:00Z", "2005-03-27T09:00Z", 600, 100],
    ["America/New_York", "2026-03-07T12:00Z", "2026-03-10T12:00Z", 300, 100],
    ["UTC", "2026-01-15T00:00Z", "2026-04-15T00:00Z", 900, 300],
  ])(
    "holds the floor across a clock's forward jump in %s",
    (timeZone, from, to, span, minTickSpacing) => {
      const min = ms(from);
      const max = ms(to);
      const ticks = timeTicks({ timeZone, locale: "en-US" }).ticks(
        context(min, max, span, minTickSpacing),
      );
      const minStepMs = (minTickSpacing * (max - min)) / span;

      expect(ticks.length).toBeGreaterThan(1);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i].value - ticks[i - 1].value).toBeGreaterThanOrEqual(minStepMs);
      }
    },
  );

  /**
   * **A year can be short too.** Apia crossed the date line at the end of
   * 2011, so that year ran 364 days — one day under the 365 the ladder has
   * to call a year, and under a request pinned to it. The year rung needs
   * the same floor as the rest.
   */
  it("drops a year that a date-line crossing left short", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const min = Date.UTC(2009, 0, 1);
    const max = Date.UTC(2014, 0, 1);
    const ticks = timeTicks({ timeZone: "Pacific/Apia", locale: "en-US" }).ticks(
      context(min, max, (max - min) / DAY_MS, 365),
    );

    // 2011 would sit 364 days after 2010 — the only boundary left out.
    expect(ticks.map((tick) => tick.label)).toEqual(["2009", "2010", "2012", "2013", "2014"]);
  });

  /**
   * **The year ladder only ever asks about years the window covers.** The
   * whole range a `Date` can hold wants a hundred-thousand-year step, and
   * the nearest multiple below its first year is a year no `Date` reaches
   * — asking a zone to read it used to throw.
   */
  it("spans the whole range a Date can hold", () => {
    const ticks = timeTicks(UTC).ticks(context(-8.64e15, 8.64e15, 800, 100));

    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.map((tick) => tick.value)).toEqual(
      [...ticks.map((tick) => tick.value)].sort((a, b) => a - b),
    );
  });

  /**
   * The earliest instant a `Date` can hold falls in an April, so its own
   * year's January is a reading no zone can be asked to read. A single-year
   * step at that edge used to ask anyway.
   */
  it("starts at the earliest January it can be asked about", () => {
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const ticks = timeTicks(UTC).ticks(context(-8.64e15, -8.64e15 + 5 * YEAR_MS, 800, 100));

    expect(ticks.length).toBe(5);
    expect(new Date(ticks[0].value).toISOString()).toBe("-271820-01-01T00:00:00.000Z");
  });

  /**
   * **A January the clock skipped still opens its year.** Kathmandu moved
   * its clock a quarter hour into 1986, so that year has no midnight of its
   * own and the boundary resolves forward to 00:15 — the first instant the
   * year had. A window opening exactly there gets it; asking whether the
   * window opens *on a midnight* would not.
   */
  it("opens on a January the clock skipped", () => {
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const min = ms("1985-12-31T18:30:00Z"); // 1986-01-01 00:15 in Kathmandu
    const ticks = timeTicks({ timeZone: "Asia/Katmandu", locale: "en-US" }).ticks(
      context(min, min + 5 * YEAR_MS, 800, 100),
    );

    expect(ticks[0].value).toBe(min);
    expect(ticks.map((tick) => tick.label)).toEqual(["00:15", "1987", "1988", "1989", "1990"]);
  });

  /**
   * **A window that opens half a millisecond into a year does not get that
   * year's January.** A zone reads whole seconds, so the opening reading is
   * January the 1st at midnight either way — the boundary itself has to be
   * measured against the window, not the reading.
   */
  it.each([
    [0, ["2020", "2021", "2022", "2023", "2024"]],
    [0.5, ["2021", "2022", "2023", "2024"]],
  ])("opens on a January only when the window does (+%sms)", (fraction, expected) => {
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const min = Date.UTC(2020, 0, 1) + fraction;
    const ticks = timeTicks(UTC).ticks(context(min, min + 5 * YEAR_MS, 800, 100));

    expect(ticks.map((tick) => tick.label)).toEqual(expected);
  });
});

describe("timeTicks — the most it will draw", () => {
  /**
   * A strategy answers at most a thousand. The mark that stands for a
   * stretch the clock skipped is one of them and not a thousand-and-first.
   */
  it("counts the mark a skipped stretch earns against the same limit", () => {
    // Nearly three years of Santiago at a fine grid: the thousandth tick
    // falls in August 2024 and a September landing waits behind it, far
    // enough from its neighbours that only the limit stands in its way.
    const ticks = timeTicks({ timeZone: "America/Santiago", locale: "en-US" }).ticks(
      context(ms("2021-12-01T00:00Z"), ms("2024-09-10T00:00Z"), 1690, 1),
    );

    expect(ticks.length).toBe(1000);
  });
});

describe("timeTicks — the start of what a Date can hold", () => {
  /**
   * The first run follows nothing. Reading it as though a clock had skipped
   * its way there would put a mark where the search happened to begin.
   */
  it("invents nothing where the search starts", () => {
    const first = -8.64e15;
    const kathmandu = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kathmandu",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    const ticks = timeTicks({ timeZone: "Asia/Kathmandu", locale: "en-US" }).ticks(
      context(first, first + 60 * 60 * 1000),
    );

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.value).not.toBe(first);
      expect(kathmandu.format(tick.value)).toMatch(/^(00|15|30|45):00$/);
    }
  });
});

describe("timeTicks — the far edge of time", () => {
  /**
   * Resolving a reading looks a day either side of it, and at the last hour
   * a `Date` can hold there is no day on one side. Falling off there would
   * take the whole frame down with a message naming nothing.
   */
  it("still draws a window at the end of what a Date can hold", () => {
    const last = 8.64e15;

    const ticks = timeTicks({ timeZone: "America/New_York", locale: "en-US" }).ticks(
      context(last - 60 * 60 * 1000, last - 1),
    );

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.value).toBeLessThan(last);
    }
  });
});

describe("timeTicks — the cost of a jump", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Samoa's clocks jumped a whole day at the end of 2011. Zoomed to ten
   * seconds across it, a one-second grid has 86,400 readings the country
   * never showed between the window and the moment the clock resumed.
   * Asking each of them costs four calendar lookups for no tick, so the
   * walker finds where the clock resumes instead of walking to it.
   */
  it("asks about the readings a jump swallowed a few times, not once each", () => {
    const lookups = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");

    const ticks = timeTicks({ timeZone: "Pacific/Apia", locale: "en-US" }).ticks(
      context(ms("2011-12-30T09:59:55Z"), ms("2011-12-30T10:00:05Z")),
    );

    expect(ticks.length).toBe(11);
    expect(lookups.mock.calls.length).toBeLessThan(300);
  });

  /**
   * The mirror of it. Kwajalein moved across the date line in 1969 by
   * repeating 23 hours, so a window inside the second turn of those
   * readings has no reading of its own — every one of them answers the
   * first turn, a day behind. The right answer is no ticks at all, and
   * finding that out should not cost a question per second of the repeat.
   */
  it("does not walk the second turn of a repeated day", () => {
    const lookups = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");

    const ticks = timeTicks({ timeZone: "Pacific/Kwajalein", locale: "en-US" }).ticks(
      context(ms("1969-09-30T13:00:00Z"), ms("1969-09-30T13:00:10Z")),
    );

    expect(ticks).toEqual([]);
    // Tight on purpose. A repeat this wide is answered by measuring it, not
    // by asking about each of its seconds, so the count stays in the tens.
    expect(lookups.mock.calls.length).toBeLessThan(150);
  });

  /**
   * Where the repeat ends. New York's clocks fall back at 02:00, so the
   * readings from 01:00 answer their first turn, an hour before this
   * window — and 02:00, the first reading the clock shows only once, is
   * the one tick in it. A jump that lands on a reading has to let the
   * walker ask it, and the loop's own step takes the last one.
   */
  it("asks about the reading a jump lands on", () => {
    const ticks = timeTicks({ timeZone: "America/New_York", locale: "en-US" }).ticks(
      context(ms("2026-11-01T06:00:00Z"), ms("2026-11-01T07:10:00Z")),
    );

    expect(ticks.map((tick) => tick.value)).toEqual([ms("2026-11-01T07:00:00Z")]);
  });

  /**
   * **A landing that came to rest exactly on a grid reading is one tick,
   * not two.** New York's clock lands on 03:00 and every rung's grid
   * stands on 03:00; the point is the one kept. Asked for a spacing no
   * screen resolves, nothing downstream would tell the two apart, so the
   * walk has to name the instant once itself.
   */
  it("names an instant once where the landing and the grid coincide", () => {
    const landed = ms("2026-03-08T07:00Z");
    const ticks = timeTicks({ timeZone: "America/New_York", locale: "en-US" }).ticks(
      context(landed, landed + 1000 * 1000, 800, 1e-7),
    );

    const values = ticks.map((tick) => tick.value);
    expect(values[0]).toBe(landed);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * And the reason a jump may not measure past a change of clock. Algiers
   * gave back an hour in 1916; this window starts inside the hour it
   * repeated and ends three minutes after the repeat is over. Measured
   * from inside, the window looks an hour away — and a move of that whole
   * distance lands an hour past the three readings that are actually in it.
   */
  it("does not measure a jump across the change it is jumping over", () => {
    const ticks = timeTicks({ timeZone: "Africa/Algiers", locale: "en-US" }).ticks(
      context(ms("1916-10-01T23:42:30.659Z"), ms("1916-10-02T00:02:30.659Z"), 1200, 60),
    );

    expect(ticks.map((tick) => tick.value)).toEqual([
      ms("1916-10-02T00:00:00Z"),
      ms("1916-10-02T00:01:00Z"),
      ms("1916-10-02T00:02:00Z"),
    ]);
  });
});

/**
 * **The cap bounds what a rung offers; spacing then chooses among it.** A
 * rung offers about `span / minTickSpacing` boundaries, so a thousand is
 * reached only by an axis asking for a thousand labels, and there the
 * offer stops — the spacing rule then keeps fewer, and a landing offered
 * last is judged only against what was offered with it. Counting only
 * what survives would need the offer to be resumable — asked for more as
 * room is found, with a later heavy boundary able to unseat an earlier
 * choice — which is more machinery than an axis asking for a thousand
 * labels is worth.
 */
/**
 * **Which of two crowded equals is kept is a fact about time, not about
 * pixels.** A vertical axis usually runs its range downward, so a choice
 * made by pixel order would keep the later of every crowded pair there
 * and the earlier everywhere else.
 */
describe("timeTicks — an axis that runs the other way", () => {
  it.each([
    ["upward", (value: number, span: number, min: number, max: number) => ((value - min) / (max - min)) * span],
    ["downward", (value: number, span: number, min: number, max: number) => span - ((value - min) / (max - min)) * span],
  ])("keeps the earlier of two crowded equals, %s", (_name, positionOf) => {
    const min = ms("2026-01-15T00:00Z");
    const max = ms("2026-04-15T00:00Z");
    const ticks = timeTicks(UTC).ticks({
      ...context(min, max, 900, 300),
      positionOf: (value) => positionOf(value, 900, min, max),
    });

    expect(ticks.map((tick) => tick.label)).toEqual(["Feb", "Apr"]);
  });
});

describe("timeTicks — the thousand-boundary cap", () => {
  it("offers a thousand, and spacing keeps what fits", () => {
    const min = ms("2026-01-01T00:00Z");
    const ticks = timeTicks({ timeZone: "America/New_York", locale: "en-US" }).ticks(
      context(min, min + 1100 * 24 * 3600 * 1000, 1100, 1),
    );

    // Three of the thousand offered stood a twenty-three-hour day apart.
    expect(ticks).toHaveLength(997);
    expect(ticks[ticks.length - 1].value).toBe(ms("2028-09-26T04:00Z"));
  });

  it("judges a landing offered last against what was offered with it", () => {
    const ticks = timeTicks({ timeZone: "Africa/Monrovia", locale: "en-US" }).ticks(
      context(62_693_970_000, 63_596_670_000, 1003, 1),
    );

    // The landing is the thousandth boundary offered; the grid point it
    // would give way to was not, so it stands.
    expect(ticks).toHaveLength(1000);
    expect(ticks[ticks.length - 1].value).toBe(ms("1972-01-07T00:44:30Z"));
  });
});

/**
 * **A week's tick is a Monday.** The weekly rung is the one whose phase is
 * not a midnight but a particular midnight, and nothing else on the axis
 * would notice if it drifted to whatever weekday the window happened to
 * open on — the ticks would still be seven days apart.
 */
describe("timeTicks — the weekly rung", () => {
  it.each(["Asia/Seoul", "America/New_York", "UTC"])("stands on Mondays in %s", (timeZone) => {
    // Ninety days at 800px, 60px apart: 6.75 days between ticks, past the two-day rung.
    const ticks = timeTicks({ timeZone, locale: "en-US" }).ticks(
      context(ms("2026-01-01T00:00Z"), ms("2026-04-01T00:00Z"), 800, 60),
    );

    expect(ticks.length).toBeGreaterThanOrEqual(10);
    for (const tick of ticks) {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(tick.value);
      expect(weekday).toBe("Mon");
    }
  });
});

/**
 * **A year label is a number, and before year 1 a number is not enough.**
 * These run the `en-US` Gregorian formatter, where a year without its era
 * is the year within that era: 1 BCE and 1 CE both come out "1" — two
 * ticks a year apart wearing the same word — and every earlier year a
 * positive number that reads as a later one.
 *
 * The era is asked for only below year 1, which is why the ordinary axis
 * is left alone: asked for everywhere, this formatter would put "AD" on
 * every ordinary Gregorian year label of every chart anyone actually draws.
 */
describe("timeTicks — years before 1", () => {
  /** January 1st of an astronomical year, the numbering `zone.parts` uses. */
  const januaryOf = (year: number) => {
    const at = new Date(0);
    at.setUTCFullYear(year, 0, 1);
    at.setUTCHours(0, 0, 0, 0);
    return at.getTime();
  };

  it("tells the years either side of the era apart", () => {
    const ticks = timeTicks(UTC).ticks(context(januaryOf(-2), januaryOf(3)));

    expect(ticks.map((tick) => tick.label)).toEqual([
      "3 BC",
      "2 BC",
      "1 BC",
      "1",
      "2",
      "3",
    ]);
  });

  /**
   * **The era is read off the zone's own year, not UTC's.** Seoul's clock
   * ran 8:27:52 ahead then, so its year 1 opens while UTC is still in year
   * 0 — the two axes put the boundary at different instants and label them
   * from their own calendars, and both are right.
   */
  it("reads the era off the zone's year", () => {
    const ticks = timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" }).ticks(
      context(januaryOf(-2), januaryOf(3)),
    );

    expect(ticks.map((tick) => tick.label)).toEqual(["2 BC", "1 BC", "1", "2", "3"]);
    // The third of these is the instant that tells the two clocks apart:
    // Seoul is opening year 1 while UTC still has 8:27:52 of year 0 to go,
    // and UTC's year formatter would render that instant "1 BC".
    expect(ticks.map((tick) => new Date(tick.value).toISOString())).toEqual([
      "-000002-12-31T15:32:08.000Z",
      "-000001-12-31T15:32:08.000Z",
      "0000-12-31T15:32:08.000Z",
      "0001-12-31T15:32:08.000Z",
      "0002-12-31T15:32:08.000Z",
    ]);
  });

  it("leaves an ordinary year unadorned", () => {
    const ticks = timeTicks(UTC).ticks(context(januaryOf(2023), januaryOf(2028)));

    expect(ticks.map((tick) => tick.label)).toEqual([
      "2023",
      "2024",
      "2025",
      "2026",
      "2027",
      "2028",
    ]);
  });
});

describe("timeTicks.format — the decorations' label, in the strategy's own clock", () => {
  const at = ms("2026-09-12T02:15:07Z");
  const intl = (locale: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

  it("reads like Intl in that locale and zone, seconds included", () => {
    const strategy = timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" });
    if (!strategy.format) throw new Error("timeTicks should offer a format");
    expect(strategy.format(at)).toBe(intl("en-US", "Asia/Seoul").format(at));
    expect(strategy.format(at)).toContain("07");
  });

  it("follows the zone — Seoul and UTC do not say the same hour", () => {
    const seoul = timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" }).format?.(at);
    const utc = timeTicks(UTC).format?.(at);
    expect(seoul).not.toBe(utc);
    expect(utc).toBe(intl("en-US", "UTC").format(at));
  });

  it("goes through epochOf — a feed whose x is in seconds is read as seconds", () => {
    const strategy = timeTicks({ ...UTC, epochOf: (x) => x * 1000, xOfEpoch: (t) => t / 1000 });
    expect(strategy.format?.(at / 1000)).toBe(intl("en-US", "UTC").format(at));
  });

  it("speaks the locale it was given — German reads the date the German way", () => {
    const de = timeTicks({ timeZone: "UTC", locale: "de-DE" }).format?.(at);
    expect(de).toBe(intl("de-DE", "UTC").format(at));
    expect(de).not.toBe(intl("en-US", "UTC").format(at));
  });

  it("prints midnight as 00, never 24", () => {
    const midnight = ms("2026-01-01T00:05:07Z");
    const label = timeTicks(UTC).format?.(midnight) ?? "";
    expect(label).toContain("00:05:07");
    expect(label).not.toContain("24:");
  });

  it("reads a non-instant as the plain number instead of throwing out of a draw", () => {
    const strategy = timeTicks(UTC);
    // The same words a strategy-less plot prints for that x — `DEFAULT_X_FORMAT`.
    expect(strategy.format?.(Number.NaN)).toBe("NaN");
    expect(strategy.format?.(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(timeTicks({ ...UTC, epochOf: () => Number.NaN }).format?.(5)).toBe("5");
  });

  it("reads an instant past what a Date can hold as the plain number — Intl would throw mid-draw", () => {
    const strategy = timeTicks(UTC);
    const edge = 8.64e15;
    // Both ends are instants a Date holds — labelled, not rounded (the far past wears its era).
    expect(strategy.format?.(edge)).toBe(intl("en-US", "UTC").format(edge));
    expect(strategy.format?.(-edge)).toBe(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        era: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(-edge),
    );
    expect(strategy.format?.(edge + 1)).toBe(DEFAULT_X_FORMAT(edge + 1));
    expect(strategy.format?.(-edge - 1)).toBe(DEFAULT_X_FORMAT(-edge - 1));
    // A converted x lands there too — the bound is checked after `epochOf`.
    const seconds = timeTicks({ ...UTC, epochOf: (x) => x * 1000, xOfEpoch: (t) => t / 1000 });
    expect(seconds.format?.(8.64e12 + 1)).toBe(DEFAULT_X_FORMAT(8.64e12 + 1));
  });

  it("names the era below year 1 — 1 BCE and 1 CE do not read the same, as on the axis", () => {
    const strategy = timeTicks(UTC);
    const bce = strategy.format?.(ms("0000-06-01T12:00:00Z")) ?? "";
    const ce = strategy.format?.(ms("0001-06-01T12:00:00Z")) ?? "";
    expect(bce).not.toBe(ce);
    expect(bce).toMatch(/BC/);
    expect(ce).not.toMatch(/BC|AD/);
  });

  it("always shows seconds — the precision does not move between instants", () => {
    const strategy = timeTicks(UTC);
    const onTheMinute = strategy.format?.(ms("2026-09-12T02:15:00Z")) ?? "";
    const offTheMinute = strategy.format?.(ms("2026-09-12T02:15:07Z")) ?? "";
    expect(onTheMinute.length).toBe(offTheMinute.length);
    expect(onTheMinute).toContain(":00");
  });
});
