/**
 * Time zone arithmetic — with `Intl.formatToParts` alone, no library needed.
 *
 * Two directions. Reading a clock is total: every instant has exactly one
 * wall-clock reading in a zone. Writing one is not — at an offset transition
 * a reading either never happens or happens twice, so the inverse needs a
 * rule, and `resolve` is the one place that rule lives. Everything that turns a
 * calendar boundary into an instant — the axis's day, month and year steps,
 * and a session's start — reads its clock through this, so none of them
 * keeps one of its own. They do not all ask the same thing of it: a month,
 * a year and a session each resolve a single reading, while the fixed-step
 * axis lays its grid on the reading axis and walks the runs a clock cuts
 * that axis into, resolving nothing.
 */

import { ContractError, describe } from "../primitives";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY = 24 * HOUR_MS;

/** The widest instant a `Date` — and so `Intl` — will read. */
const LAST_INSTANT = 8.64e15;

const SECOND = 1000;

/**
 * How far apart to look for a clock move.
 *
 * Two moves closer than this would hide between two looks. The tightest
 * pair in the installed database is 167 hours — three Brazilian zones in
 * October 2000, an hour under seven days — so five days leaves not quite
 * two days of room. The database ships with the runtime and can change, so
 * a test asserts the same number over the zones most likely to move oddly.
 * It is a sample, not a proof: it would catch a change to one of those
 * zones, not one to a zone nobody thought to list.
 */
const MOVES_STAND_APART = 5 * 24 * 60 * 60 * 1000;

/**
 * A stretch of the wall-clock axis over which a reading and the instant it
 * names differ by a fixed amount. Reading minus `offset` is the instant, by
 * plain arithmetic, for every reading from `from` up to but not including
 * `to`.
 *
 * Consecutive runs meet where a clock moved back, and stand apart where one
 * moved forward — the readings between them are the ones it skipped, which
 * name no instant at all. The moment it landed on is the next run's `from`
 * minus its `offset`.
 */
export interface ReadingRun {
  from: number;
  to: number;
  offset: number;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * **A reading is a place on the wall-clock axis, and that axis is not a
 * `Date`.** Encoding one through `Date` borrows its range, and the two are
 * not the same: a zone reads a perfectly good instant into a reading that
 * `Date` cannot encode, and `Etc/GMT+12` at the earliest instant a `Date`
 * holds is such a reading. Encoding it returned `NaN`, which spread into
 * every offset and run built from it, and an axis drew nothing at all.
 *
 * Counted instead, in days: the Gregorian calendar is arithmetic, it runs
 * as far as a number does, and it needs no clock to do it. `Date.UTC` also
 * reads a year below 100 as 1900 plus it, and 1900 is not even the same
 * shape as year 0 — one is a leap year and the other is not — so counting
 * removes that trap with the range.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  // Howard Hinnant's civil-from-days, with March starting the year so a
  // leap day falls at the end of it and no month needs a special case.
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The wall-clock reading those parts name, counted rather than encoded. */
function readingOf(parts: ZonedParts): number {
  // A month or day past the end of its own is carried by the count itself:
  // the 32nd of January is the 1st of February, which is what a session
  // asking for "the day after this one" relies on.
  const months = (parts.year * 12 + (parts.month - 1)) | 0;
  const year = Math.floor(months / 12);
  const month = months - year * 12 + 1;
  return (
    daysFromCivil(year, month, parts.day) * DAY +
    parts.hour * HOUR_MS +
    parts.minute * MINUTE_MS +
    parts.second * SECOND_MS
  );
}

export class Zone {
  private readonly dtf: Intl.DateTimeFormat;

  constructor(timeZone?: string) {
    try {
      this.dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        era: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch (error) {
      // The same reason the reading door exists: a name out of a saved
      // chart or a settings pane is a plain mistake, and `Intl` answers it
      // with a bare `RangeError` naming neither the value nor who passed
      // it. Anything else that went wrong here is not ours to rewrite.
      if (!(error instanceof RangeError)) throw error;
      throw new ContractError(`not a time zone this runtime knows: ${describe(timeZone)}`);
    }
  }

  parts(ms: number): ZonedParts {
    // The one door. `Intl` answers a reading for every instant a `Date` can
    // hold and throws a bare `RangeError` for anything else, which says
    // nothing about which value was wrong or who passed it. A bar's x
    // reaches this through a session start, and a feed that hands over
    // microseconds instead of milliseconds is an ordinary mistake, so the
    // refusal names the number.
    if (!Number.isFinite(ms) || Math.abs(ms) > LAST_INSTANT) {
      throw new ContractError(
        `a time zone can only read an instant a Date can hold, got ${ms}`,
      );
    }
    const parts: Record<string, number> = {};
    let era = "AD";
    for (const { type, value } of this.dtf.formatToParts(ms)) {
      if (type === "era") era = value;
      else if (type !== "literal") parts[type] = Number(value);
    }
    return {
      // `Intl` counts eras, not a number line: it calls 1 BCE "year 1 BC".
      // Everything else here is arithmetic, so the years become one line —
      // 1 BCE is 0, 2 BCE is −1. The era is read by its first letter
      // because the two conventions differ in the rest of it: "BC" and
      // "BCE" both begin with the B, while "AD" and "CE" do not.
      year: era.startsWith("B") ? 1 - parts.year : parts.year,
      month: parts.month,
      day: parts.day,
      // Some environments render midnight as 24 with hour12:false.
      hour: parts.hour === 24 ? 0 : parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  }

  /** Wall-clock parts in that zone → UTC ms. */
  toUtc(parts: ZonedParts): number {
    return this.resolve(this.localOf(parts));
  }

  /**
   * The point on the wall-clock axis these parts name. No instant is
   * involved, so no rule is needed — which is what makes it the right
   * coordinate to do calendar arithmetic in. Stepping a grid or walking
   * back to Monday here is exact, and only the last step, the one that
   * names an instant, has to decide what a skipped or repeated reading means.
   */
  localOf(parts: ZonedParts): number {
    return readingOf(parts);
  }

  /** UTC offset (ms) at this timestamp. wall clock = UTC + offset. */
  private offsetAt(ms: number): number {
    return this.toLocal(ms) - ms;
  }

  /**
   * Coordinates on the wall-clock axis. Every instant has exactly one
   * reading, to the second; the inverse is the direction that needs a rule.
   */
  private toLocal(ms: number): number {
    return this.localOf(this.parts(ms));
  }



  /**
   * The wall-clock axis over `[fromMs, toMs]`, cut into the stretches where
   * the clock keeps a fixed distance from time.
   *
   * It is worth having because it turns a walk into arithmetic: inside a
   * run there is nothing to decide, so a grid of readings becomes a grid of
   * instants by subtraction.
   *
   * A run ends where the clock last showed its old distance from time, at
   * `move + before`, and the next begins at `move + max(before, after)`.
   * Where the clock moved back those are the same place, and the readings
   * it repeated belong to the run before — their first turn is the one that
   * counts. Where it moved forward the two stand apart, and the readings
   * between them are ones the clock never showed.
   */
  runs(fromMs: number, toMs: number): ReadingRun[] {
    // Held inside the range a `Date` can hold, the way `resolve` holds its
    // own looks: a caller may ask about the very edge of time.
    // Whole seconds throughout. An offset read at a fractional millisecond
    // carries that fraction — the clock does not, it only shows seconds —
    // and a run seeded with one would put every instant it names off the
    // second by the same sliver.
    const from0 = Math.max(Math.floor(fromMs / SECOND) * SECOND, -LAST_INSTANT);
    const to0 = Math.min(Math.ceil(toMs / SECOND) * SECOND, LAST_INSTANT);
    const runs: ReadingRun[] = [];
    let offset = this.offsetAt(from0);
    // The runs cover the readings of every instant asked about, and say
    // nothing about readings outside them: a run's arithmetic is only known
    // to hold where the clock was looked at.
    let from = from0 + offset;
    for (const move of this.movesIn(from0, to0)) {
      runs.push({ from, to: move.at + move.before, offset: move.before });
      from = move.at + Math.max(move.before, move.after);
      offset = move.after;
    }
    // A query that ends inside a stretch the clock repeated has an end
    // reading behind where the last run starts. The run is then empty
    // rather than backwards — a caller reads `from` and `to` as a range,
    // and an inverted one is not a range at all.
    runs.push({ from, to: Math.max(from, to0 + offset + 1), offset });
    return runs;
  }

  /**
   * Where the clock moved between two instants, and by how much. Looked for
   * in whole seconds: an offset read at a fractional millisecond carries
   * that fraction, so two looks a fraction apart would read as a move.
   */
  private movesIn(
    fromMs: number,
    toMs: number,
  ): Array<{ at: number; before: number; after: number }> {
    const moves: Array<{ at: number; before: number; after: number }> = [];
    let at = Math.max(Math.floor(fromMs / SECOND) * SECOND, -LAST_INSTANT);
    const end = Math.min(Math.ceil(toMs / SECOND) * SECOND, LAST_INSTANT);
    let before = this.offsetAt(at);

    while (at < end) {
      const next = Math.min(at + MOVES_STAND_APART, end);
      const after = this.offsetAt(next);
      if (after !== before) {
        let held = at;
        let moved = next;
        while (moved - held > SECOND) {
          const middle = held + Math.floor((moved - held) / (2 * SECOND)) * SECOND;
          if (middle === held) break;
          if (this.offsetAt(middle) === before) held = middle;
          else moved = middle;
        }
        moves.push({ at: moved, before, after });
        before = after;
      }
      at = next;
    }
    return moves;
  }

  /**
   * A wall-clock reading → the instant it names.
   *
   * The reading is not always a function of time, so two cases carry a
   * decision rather than an answer:
   *
   * - **It never happens.** The clock jumped over it (spring forward), so
   *   there is no instant to return. It resolves **forward, by the length
   *   of the jump** — which lands on the moment the clock landed only when
   *   the jump began at the reading asked about. Santiago's clocks jump at
   *   midnight, so 2024-09-08 00:00 there answers 01:00, the day's first
   *   real moment. Where a jump begins *before* the reading — Toronto's
   *   1919 clocks went from the 30th's 23:30 to the 31st's 00:30, so the
   *   31st's midnight is inside the jump rather than at its start — this
   *   answers later than the clock landed, and a caller wanting the first
   *   instant of that day wants `firstFrom` instead.
   * - **It happens twice.** The clock fell back over it, so two instants
   *   carry the same reading. It resolves to the **first** — the earlier
   *   instant, which is the one that starts the session.
   *
   * Both rules are idempotent — the answer reads back to itself, or in the
   * skipped case to the reading the clock landed on, which answers itself.
   * They are **not** order-preserving across a move: a skipped reading is
   * carried past it and can answer the same instant as a later real one.
   * Anything that wants a sequence of readings should ask for `runs` and do
   * arithmetic inside each, rather than resolving one reading at a time and
   * repairing the order afterwards.
   */
  /**
   * The earliest instant whose reading is at or after `reading`.
   *
   * **This is not `resolve`, and the difference is a whole class of bug.**
   * A reading a clock skipped resolves forward by the length of the jump,
   * which is the moment the clock landed only if the jump started there.
   * Where a jump straddles the reading — Toronto's clocks went from the
   * 30th's 23:30 to the 31st's 00:30 in 1919, so that day's midnight sits
   * *inside* the jump — resolving answers later than the day began, and a
   * session opened on it would start after instants that belong to it.
   *
   * Read off the runs instead: the first one that reaches past the reading
   * answers either at the reading itself, or at its own beginning where
   * the reading fell in the gap before it.
   *
   * **The answer is only an instant where a `Date` can hold one.** Ask
   * near either end of what it holds and the arithmetic runs past that
   * end; the caller is what refuses there, because what counts as too far
   * is the caller's own reach rather than this one's — `sessionStart`
   * checks the opening it gets back.
   */
  firstFrom(reading: number): number {
    /**
     * **Up to a whole second first.** A clock is asked about seconds and
     * no finer, so a reading between two of them is not one — and the
     * earliest reading *at or after* it is the next whole second, not the
     * one beneath. Rounding down would answer earlier than asked, and
     * leaving the remainder on would carry it into every offset sampled
     * from here, which is how a millisecond once became two.
     *
     * Up to a whole millisecond before the division, because the division
     * is where a small enough reading stops existing: `5e-324 / 1000`
     * underflows to zero, and rounding that up answers *before* what was
     * asked for. The correction has to run while there is still something
     * left to correct.
     */
    const wanted = Math.ceil(Math.ceil(reading) / SECOND) * SECOND;

    // A reading the clock did show is its own earliest instant, and that
    // is nearly every reading ever asked about — so it is answered on the
    // way past, and only a reading the clock skipped pays for a walk.
    const { at, shown } = this.resolving(wanted);
    if (shown) return at;

    // A run's readings stand within a day of the instants they name, and
    // no clock stands further off than that, so two days either side holds
    // every run that can answer.
    for (const run of this.runs(wanted - 2 * DAY, wanted + 2 * DAY)) {
      if (run.to <= wanted) continue;
      return Math.max(run.from, wanted) - run.offset;
    }
    // Beyond every run the scan covered, which the window above rules out.
    return at;
  }

  private resolve(wanted: number): number {
    // The offsets a day either side of the reading: any transition near it
    // lies between them. A day is wide enough to straddle one and narrow
    // enough to catch no other — measured over the whole installed zone
    // database from 1900 to 2035, the closest two transitions anywhere are
    // a week apart (166.9 hours, America/Boa_Vista in 2000) and the
    // largest single move is a day (Samoa crossing the date line in 2011).
    // Held inside the range a `Date` can hold: near the very edge of time
    // there is no day to look either side, and the offset there is the
    // offset at the edge.
    return this.resolving(wanted).at;
  }

  /**
   * `resolve`, and whether the clock ever showed the reading.
   *
   * The two are found together because finding them apart costs a reading:
   * where the offset is the same a day either side there is no move near,
   * so the reading is one the clock showed and nothing needs to be asked
   * to know it. Only an ambiguous neighbourhood pays.
   */
  private resolving(wanted: number): { at: number; shown: boolean } {
    const early = wanted - this.offsetAt(Math.max(wanted - DAY, -LAST_INSTANT));
    const late = wanted - this.offsetAt(Math.min(wanted + DAY, LAST_INSTANT));
    if (early === late) return { at: early, shown: true };

    const earlyReads = this.toLocal(early) === wanted;
    const lateReads = this.toLocal(late) === wanted;
    if (earlyReads && lateReads) return { at: Math.min(early, late), shown: true };
    if (earlyReads) return { at: early, shown: true };
    if (lateReads) return { at: late, shown: true };
    // Neither reads back: the clock jumped over this reading. The larger of
    // the two is the reading carried past the jump — the offset in force
    // before it, applied to a reading that only exists after.
    return { at: Math.max(early, late), shown: false };
  }
}
