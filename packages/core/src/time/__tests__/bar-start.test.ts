import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractError } from "../../primitives";
import { fixedBars } from "../fixed-bars";
import { sessionStart } from "../session-start";
import type { BarStart } from "../bar-start";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ms = (iso: string) => Date.parse(iso);

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * **Three laws are the public contract**, and a consumer's own check falls
 * out of them: `f(bar.x) === bar.x` says a history page is on the grid the
 * chart is drawing. They are asserted on both producers, over windows that
 * cross the places a clock moves.
 */
function obeysTheLaws(barStart: BarStart, from: number, to: number, step: number): void {
  let previous = barStart(from);
  for (let at = from; at <= to; at += step) {
    const start = barStart(at);

    expect(start).toBeLessThanOrEqual(at);
    expect(barStart(start)).toBe(start);
    expect(start).toBeGreaterThanOrEqual(previous);
    previous = start;
  }
}

describe("chokepoint 9 — fixedBars, the width and the instant it is asked about", () => {
  it("floors to the epoch-aligned grid", () => {
    const minutes = fixedBars({ interval: MINUTE });

    expect(minutes(ms("2026-03-02T07:41:29.750Z"))).toBe(ms("2026-03-02T07:41:00Z"));
    expect(minutes(ms("2026-03-02T07:41:00Z"))).toBe(ms("2026-03-02T07:41:00Z"));
  });

  it("keeps the three laws, before the epoch as well as after", () => {
    obeysTheLaws(fixedBars({ interval: 15 * MINUTE }), ms("1969-12-31T00:00Z"), ms("1970-01-02T00:00Z"), 97 * 1000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses an interval of %s",
    (interval) => {
      expect(() => fixedBars({ interval })).toThrow(ContractError);
    },
  );

  /**
   * **Only the lower bound is arithmetic.** Below a millisecond the
   * division runs to infinity and the answer stands ahead of its own
   * instant. The day above is a decision: a two-day epoch grid keeps all
   * three laws, and is refused because the epoch is the wrong thing to
   * align it to, not because the laws say so.
   */
  it.each([1.5, Number.MIN_VALUE, 25 * 60 * 60 * 1000, 3_333_333_333_333_333])(
    "refuses a width of %s",
    (interval) => {
      expect(() => fixedBars({ interval })).toThrow(ContractError);
    },
  );
});

/**
 * **A bar start answers for an instant, and `NaN` is not one.** All three
 * laws are silently true of `NaN` — it compares false against everything —
 * so a producer that passed it through would advertise a contract it does
 * not keep. How far in a producer can be asked is its own: a session
 * stops three days inside what a `Date` holds, because it names the
 * midnight two days out to know where its own ends, and a fixed grid,
 * which asks no clock anything, reaches the edge.
 */
describe("the instants a bar start answers for", () => {
  /** The last instant a `Date` can hold — what an instant is, for every producer. */
  const LAST = 8.64e15;
  /** Where a session stops asking: three days inside, because it asks about the midnight two days out. */
  const SESSION_REACH = LAST - 3 * DAY;
  const producers: [string, BarStart][] = [
    ["fixedBars", fixedBars({ interval: HOUR })],
    ["sessionStart", sessionStart({ timeZone: "Asia/Seoul" })],
  ];

  it.each(producers)("%s refuses what is not an instant at all", (_name, barStart) => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, LAST + 1, -LAST - 1]) {
      expect(() => barStart(bad)).toThrow(ContractError);
    }

    /**
     * **And what is not a number at all.** `Math.floor` takes `null`,
     * `"0"`, `false` and `[]` to zero, so taking a fraction down before
     * asking whether it is a number would turn any of them into the epoch
     * — a malformed x laundered into a well-formed bar, which is what this
     * door exists to stop rather than to do.
     */
    const open = (given: unknown): unknown => (barStart as (given: unknown) => unknown)(given);
    for (const bad of [null, undefined, "0", "", false, [], {}, 1n]) {
      expect(() => open(bad)).toThrow(ContractError);
    }

    /**
     * **A fraction of a millisecond is read as the millisecond beneath
     * it** — down, not toward zero, which is what `Date` would do and what
     * would put half a millisecond before the epoch into the day that had
     * not started yet. A feed carrying sub-millisecond precision as a
     * fraction is a real thing and the data door lets it through, so
     * refusing it here would fail deep inside a fold or an indicator.
     */
    for (const fraction of [-0.5, 0.5, -36_619_200_000.5, 1_700_000_000_000.25]) {
      expect(barStart(fraction)).toBe(barStart(Math.floor(fraction)));
      expect(barStart(fraction)).toBeLessThanOrEqual(fraction);
    }
  });

  /**
   * **How far in a producer can be asked is the producer's own.** A session
   * asks a clock about the midnight two days out and looks a day back, so
   * it stops three days inside what a `Date` holds — asked at the very
   * edge it would put a reading to a clock that no clock can be asked. A
   * fixed grid asks no clock anything: its reach is every instant a `Date`
   * holds, and a shared door that stopped three days short would be
   * lending it a limit that is not its own.
   */
  it("reaches as far as it can ask, which differs by producer", () => {
    const fixed = fixedBars({ interval: HOUR });
    expect(fixed(LAST)).toBe(LAST);
    expect(fixed(-LAST)).toBe(-LAST);

    const session = sessionStart({ timeZone: "Asia/Seoul" });
    for (const edge of [LAST, -LAST, SESSION_REACH + 1]) {
      expect(() => session(edge)).toThrow(ContractError);
      expect(() => session(edge)).toThrow(/three days/);
    }
  });

  /**
   * **Where the grid does not divide the edge, the laws hold on either side
   * of where it gives out.** An hour divides 8.64e15, so at the edge it
   * answers the edge itself and floors nothing; seven milliseconds and a
   * day less one do not, and it is there that flooring can land an answer
   * outside — so the first instant answered for is on the grid, the one
   * before it is refused, and at the far end the answer is the last grid
   * point inside.
   */
  it.each([
    [7, -8_639_999_999_999_998, 8_639_999_999_999_998],
    [86_399_999, -8_639_999_986_399_999, 8_639_999_986_399_999],
  ])("fixedBars({ interval: %i }) gives out where its grid does", (interval, opensAt, closesAt) => {
    const barStart = fixedBars({ interval });

    expect(barStart(opensAt)).toBe(opensAt);
    expect(() => barStart(opensAt - 1)).toThrow(ContractError);
    expect(barStart(opensAt + interval - 1)).toBe(opensAt);
    expect(barStart(opensAt + interval)).toBe(opensAt + interval);

    expect(barStart(LAST)).toBe(closesAt);
    expect(barStart(closesAt)).toBe(closesAt);
    expect(barStart(closesAt - 1)).toBe(closesAt - interval);
  });

  it.each([
    ["fixedBars", fixedBars({ interval: HOUR }), [LAST, -LAST], LAST],
    ["sessionStart", sessionStart({ timeZone: "Asia/Seoul" }), [SESSION_REACH, -SESSION_REACH + 3 * DAY], SESSION_REACH],
  ] as const)("%s keeps the laws at its own far edges", (_name, barStart, edges, bound) => {
    for (const edge of edges) {
      const start = barStart(edge);

      expect(start).toBeLessThanOrEqual(edge);
      // The answer is inside the reach too, so the laws apply to it again.
      expect(barStart(start)).toBe(start);
      expect(Math.abs(start)).toBeLessThanOrEqual(bound);
    }
  });

  /**
   * **At the very beginning of time a bar has no nameable start.** The bar
   * holding the first instants began before them, outside the set these
   * answers come from. Handing it back would make idempotence false in the
   * one place nothing would look: asking again would land on an instant
   * the producer does not answer for. The cache made this invisible for a
   * while — a second call hit the stretch just written and never reached
   * the guard at all.
   */
  /**
   * **A reader that has already answered must not answer more.** The
   * stretch a session cache holds used to be compared against before
   * anything was known about the instant, so one just past the reach fell
   * inside the stretch written for the one just inside it and the same
   * reader accepted what a new one refused. The door runs first now, and
   * this is what holds it there.
   */
  it("refuses what it would refuse cold, once it is warm", () => {
    const barStart = sessionStart({ timeZone: "UTC" });

    expect(barStart(SESSION_REACH)).toBe(Math.floor(SESSION_REACH / DAY) * DAY);
    expect(() => barStart(SESSION_REACH + 1)).toThrow(ContractError);
  });

  it.each([
    // A seven-minute grid does not divide the edge, so the bar holding the
    // first instant began before it.
    ["fixedBars", fixedBars({ interval: 7 * 60 * 1000 }), -LAST + 1, /began at .* before the earliest instant a Date can hold/],
    // Seoul's midnight stands before UTC's, so the session
    // holding the earliest instant it may be asked about opened outside.
    ["sessionStart", sessionStart({ timeZone: "Asia/Seoul" }), -SESSION_REACH, /opened at .* outside the instants a session answers for/],
  ] as const)("%s refuses an instant whose bar began before it can answer", (_name, barStart, at, said) => {
    expect(() => barStart(at)).toThrow(ContractError);
    expect(() => barStart(at)).toThrow(said);
  });

  /**
   * **And where it stops is the grid's own answer, not one number.** A
   * wider bar reaches further back and so gives out sooner; a zone that
   * stands further from UTC gives out sooner still. Without this the claim
   * would only be prose — refusal proven, but not that the place it starts
   * has anything to do with the grid.
   */
  it("stops at a place the grid decides", () => {
    /** The lowest instant a producer will answer for, by bisection. */
    const opensAt = (barStart: BarStart): number => {
      const answers = (at: number): boolean => {
        try {
          barStart(at);
          return true;
        } catch {
          return false;
        }
      };
      let refused = -LAST - 1;
      let answered = -SESSION_REACH + 2 * DAY;
      while (answered - refused > 1) {
        const middle = Math.floor((refused + answered) / 2);
        if (answers(middle)) answered = middle;
        else refused = middle;
      }
      return answered;
    };

    expect([1, 7, 86_399_999].map((interval) => opensAt(fixedBars({ interval })))).toEqual([
      -8_640_000_000_000_000, // every instant: the edge is on a 1 ms grid
      -8_639_999_999_999_998, // two in: the bar holding the first two began before the edge
      -8_639_999_986_399_999, // where a grid of a day less a millisecond first stands inside the edge
    ]);
    expect(
      ["UTC", "Asia/Seoul", "Asia/Kathmandu"].map((timeZone) =>
        opensAt(sessionStart({ timeZone })),
      ),
    ).toEqual([-8_639_999_740_800_000, -8_639_999_684_872_000, -8_639_999_674_876_000]);
  });
});

describe("chokepoint 10 — sessionStart, the instant a session is stored under", () => {
  /**
   * **The session starts at its earliest real instant, not at midnight.**
   * Santiago's clocks jumped over the midnight opening 8 September 2024, so
   * the day's first instant reads 01:00 — and Havana's ran through midnight
   * twice on 3 November, so the day's first instant is the first of the two.
   * Answering "midnight" in either case breaks the idempotence law.
   */
  it.each([
    ["America/Santiago", "2024-09-08T12:00Z", "2024-09-08T04:00Z"],
    ["America/Havana", "2024-03-10T12:00Z", "2024-03-10T05:00Z"],
    ["America/Havana", "2024-11-03T04:30Z", "2024-11-03T04:00Z"],
    ["America/Havana", "2024-11-03T05:30Z", "2024-11-03T04:00Z"],
    ["Asia/Seoul", "2024-06-01T09:00Z", "2024-05-31T15:00Z"],
  ])("opens %s on its first real instant", (timeZone, at, expected) => {
    expect(sessionStart({ timeZone })(ms(at))).toBe(ms(expected));
  });

  it.each([
    ["UTC", "2026-01-01T00:00Z"],
    ["Asia/Seoul", "2026-01-01T00:00Z"],
    ["America/Santiago", "2024-09-01T00:00Z"],
    ["America/Havana", "2024-10-28T00:00Z"],
    ["Asia/Kathmandu", "1985-12-28T00:00Z"],
    ["Australia/Lord_Howe", "2026-04-01T00:00Z"],
  ])("keeps the three laws in %s", (timeZone, from) => {
    obeysTheLaws(sessionStart({ timeZone }), ms(from), ms(from) + 20 * DAY, 89 * MINUTE);
  });

  /**
   * **A clock that moves back across midnight replays a date.** Casey put
   * its clock back three hours at local 02:00 on 5 March 2010, so the
   * reading returned to the 4th and ran through that evening a second
   * time. Reading the date off the clock and taking its midnight would
   * answer the 4th's session for an instant later than one already
   * answered with the 5th's — the monotonic law, broken by the definition
   * rather than by any bug in the walk. The session is the last one open.
   */
  /**
   * **A day that began before its own midnight.** Toronto's clocks went
   * from the 30th's 23:30 to the 31st's 00:30 in 1919, so the 31st's
   * midnight sits inside the jump rather than at its start. Resolving it
   * answered half an hour after the day had already begun — later than
   * instants that belong to the day, so the same reader answered one
   * session cold and another warm.
   */
  it("opens a day whose midnight the clock jumped over from the day before", () => {
    const toronto = (): BarStart => sessionStart({ timeZone: "America/Toronto" });
    const landed = ms("1919-03-31T04:30Z");

    expect(toronto()(landed)).toBe(landed);

    const warm = toronto();
    warm(landed - 1000);
    expect(warm(landed)).toBe(landed);
  });

  it("keeps running the session that opened, when a clock replays a date", () => {
    const casey = sessionStart({ timeZone: "Antarctica/Casey" });
    const fifth = ms("2010-03-04T13:00Z"); // 2010-03-05 00:00 in Casey

    // 01:29 on the 5th, then 23:06 on the 4th again — one session, still open.
    expect(casey(ms("2010-03-04T14:29Z"))).toBe(fifth);
    expect(casey(ms("2010-03-04T15:06Z"))).toBe(fifth);
    expect(casey(ms("2010-03-04T16:20Z"))).toBe(fifth);
    // And a fresh reader, with nothing cached, says the same.
    expect(sessionStart({ timeZone: "Antarctica/Casey" })(ms("2010-03-04T15:06Z"))).toBe(fifth);
  });

  /**
   * **One session's cache must not answer for the next one.** The laws all
   * hold for a stretch held open too long — a start that never advances is
   * still idempotent, monotonic and in the past — so they have to be asked
   * about consecutive sessions directly.
   */
  it("hands each session its own start, from one instance", () => {
    const barStart = sessionStart({ timeZone: "America/New_York" });
    const noons = [2, 3, 4, 5, 6].map((day) => ms(`2026-03-0${day}T17:00Z`));

    expect(noons.map(barStart)).toEqual([
      ms("2026-03-02T05:00Z"),
      ms("2026-03-03T05:00Z"),
      ms("2026-03-04T05:00Z"),
      ms("2026-03-05T05:00Z"),
      ms("2026-03-06T05:00Z"),
    ]);
  });

  it("refuses to guess the time zone", () => {
    // Reached the way a consumer without types reaches it: the value stays
    // unknown and the door is what widens, so nothing here claims a bad
    // value is a good one.
    const open = (options: unknown): unknown =>
      (sessionStart as (given: unknown) => unknown)(options);

    // The x it decides is stored — in a drawing's coordinates and in a
    // history cursor — so a server and a browser must not disagree on it.
    for (const missing of [{}, { timeZone: "" }, { timeZone: 9 }, { timeZone: null }]) {
      expect(() => open(missing)).toThrow(ContractError);
    }
  });

  /**
   * **What the cache promises is independence, not a constant.** Reading a
   * clock is the cost here, so the count must follow the number of sessions
   * asked about and not the number of bars in them. On a daily bar the two
   * are the same number and the cache earns nothing — that is the honest
   * shape of it, not a hole.
   */
  it("reads the clock per session, not per bar", () => {
    const readings = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const count = (bars: number, step: number): number => {
      readings.mockClear();
      const barStart = sessionStart({ timeZone: "America/New_York" });
      for (let i = 0; i < bars; i++) barStart(ms("2026-03-02T00:00Z") + i * step);
      return readings.mock.calls.length;
    };

    const oneDay = count(60, MINUTE);
    const oneDayTenTimesAsDense = count(600, MINUTE / 10);
    const tenDays = count(240, HOUR);
    const twentyDays = count(480, HOUR);

    // Ten times the bars over one session: not one extra reading.
    expect(oneDayTenTimesAsDense).toBe(oneDay);
    // Twice the sessions: at most twice the readings.
    expect(twentyDays).toBeLessThanOrEqual(2 * tenDays);
  });
});
