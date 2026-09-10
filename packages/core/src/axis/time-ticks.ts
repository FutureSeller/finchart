import { dayStartOf, readingGrid, weekStartOf } from "../time/grid";
import { Zone, type ZonedParts } from "../time/zone";
import type { TickStrategy } from "./types";

/**
 * The time-tick strategy. Places ticks at calendar boundaries instead of
 * multiples of 1·2·5×10ⁿ — the start of a minute or hour, midnight,
 * Monday, the 1st of the month, January 1st. A tick that crosses a bigger
 * boundary gets a promoted label: the first tick of a month reads "Mar",
 * the first of a year reads "2026".
 *
 * Time zone and locale are handled with `Intl` alone — no date library
 * dependency. Boundary arithmetic reads that zone's wall-clock parts and
 * writes them back through `Zone` (`../time/zone`), which owns the rule for
 * the readings a clock skips or repeats.
 */
export interface TimeTicksOptions {
  /** IANA time zone. Defaults to the runtime environment's. */
  timeZone?: string;
  /** Label language. Defaults to the runtime environment's. */
  locale?: string;
  /**
   * For when x isn't epoch ms — converts x to ms. Given as a pair with
   * `xOfEpoch`. This is where data like the examples' x — "days since a
   * reference date" — belongs.
   */
  epochOf?: (x: number) => number;
  /** Maps a boundary timestamp (ms) back to the data's x. */
  xOfEpoch?: (ms: number) => number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** The fixed-interval ladder. Above this, steps are calendar-based (month/year). */
const FIXED_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY,
  WEEK,
] as const;

const MONTH_STEPS = [1, 3, 6] as const;

/** The most boundaries a rung will offer. A label past this is unreadable anyway. */
const MAX_BOUNDARIES = 1000;

/** How much closer than asked a pair may stand: a millionth of a pixel, which no screen resolves. */
const PIXEL_SLACK = 1e-6;

export function timeTicks(options: TimeTicksOptions = {}): TickStrategy {
  const epochOf = options.epochOf ?? ((x: number) => x);
  const xOfEpoch = options.xOfEpoch ?? ((ms: number) => ms);
  const zone = new Zone(options.timeZone);
  const labels = new Labels(options.locale, options.timeZone);

  return {
    ticks({ min, max, span, minTickSpacing, xOf, domainOf, positionOf, snap }) {
      if (!(max > min) || !(span > 0)) return [];

      const window = windowOf(epochOf(xOf(min)), epochOf(xOf(max)), span, minTickSpacing);
      if (window === null) return [];

      /**
       * **Candidates, then placement, then labels — in that order, because
       * each step needs the one before it.** A boundary's label is decided
       * by the largest unit it crosses *from the tick before it*, so it
       * cannot be written until it is known which ticks survive; and which
       * survive cannot be decided until it is known where each is drawn,
       * which in a bar-index coordinate system is not where it falls.
       */
      const candidates = boundariesFor(window, zone).map((candidate) => {
        const parts = zone.parts(candidate.at);
        return {
          ...candidate,
          parts,
          rank: rankOf(parts),
          value: domainOf(xOfEpoch(candidate.at)),
        };
      });
      const placed = place(candidates, snap, positionOf, minTickSpacing);

      let previous: ZonedParts | null = null;
      return placed.map(({ at, parts, value }) => {
        const label = labels.of(at, parts, previous);
        previous = parts;
        return { value, label };
      });
    },
  };
}

/**
 * A boundary the calendar offers, before anything has chosen among them.
 * A landing is the instant a clock came to rest after skipping a stretch
 * that held a boundary; it stands for that stretch, but it is not a
 * boundary itself, so where it would crowd one it gives way.
 */
interface Candidate {
  readonly at: number;
  readonly landing: boolean;
}

interface Placed extends Candidate {
  readonly parts: ZonedParts;
  readonly rank: number;
  readonly value: number;
}

/**
 * **What a boundary is worth is a property of the boundary, not of its
 * neighbours.** Midnight on the 1st of January stands for a year, on any
 * other 1st for a month, on any other day for a day, and anything else for
 * a time of day. The label a tick wears is decided later and relatively —
 * the first tick of March wears "Mar" even on a weekly rung that never
 * lands on the 1st — but which of two crowded ticks to keep is decided
 * here, and here a boundary's own weight is the honest measure.
 */
function rankOf(parts: ZonedParts): number {
  if (parts.hour !== 0 || parts.minute !== 0 || parts.second !== 0) return 0;
  if (parts.day !== 1) return 1;
  return parts.month === 1 ? 3 : 2;
}

/**
 * **The heaviest boundary takes its place first; the rest stand where
 * there is room.** Two rules, and both prefer weight:
 *
 * - **One tick per bar.** Where the domain is a bar index, boundaries
 *   with no bar of their own — the weekend's midnights — land on the first
 *   bar after them, and several can land on one. The heaviest survives;
 *   between equals, the one whose own boundary the bar sits nearest.
 * - **No pair closer than asked.** A boundary that would draw closer to a
 *   placed one than the caller's spacing is not drawn. Placing by weight
 *   makes this a choice rather than an accident of order: a month's name
 *   is placed before the day in front of it can take the room.
 *
 * Between equals the earlier is kept, and a landing gives way to a real
 * boundary — it stands where a tick would, or not at all.
 */
function place(
  candidates: Placed[],
  snap: ((value: number) => number) | undefined,
  positionOf: (value: number) => number,
  minTickSpacing: number,
): Placed[] {
  let pool = candidates;
  if (snap !== undefined) {
    const byBar = new Map<number, { readonly held: Placed; readonly distance: number }>();
    for (const candidate of candidates) {
      const bar = snap(candidate.value);
      const distance = bar - candidate.value;
      const seen = byBar.get(bar);
      if (
        seen === undefined ||
        outranks(candidate, seen.held) ||
        (!outranks(seen.held, candidate) && distance < seen.distance)
      ) {
        byBar.set(bar, { held: { ...candidate, value: bar }, distance });
      }
    }
    pool = [...byBar.values()].map((entry) => entry.held);
  }

  // Between equals the earlier *in time* is kept — by value, not by
  // pixel, because an axis whose range runs the other way (a vertical one
  // usually does) would otherwise keep the later of every crowded pair.
  const ordered = pool
    .map((candidate) => ({ candidate, position: positionOf(candidate.value) }))
    .sort(
      (a, b) =>
        (outranks(a.candidate, b.candidate) ? -1 : outranks(b.candidate, a.candidate) ? 1 : 0) ||
        a.candidate.value - b.candidate.value,
    );

  // A pair may stand up to a millionth of a pixel closer than asked. That
  // is an absolute allowance, not a rounding rule: it is there because a
  // position is a float — two days over a ten-day window at 500px is
  // 100px in arithmetic and 99.99999999999999 in a double — and it is
  // harmless because no screen resolves the difference, on ten pixels or
  // a hundred thousand. (A spacing below the allowance makes the room
  // negative, which keeps everything; nothing draws that close anyway.)
  const room = minTickSpacing - PIXEL_SLACK;
  const taken: number[] = [];
  const out: Placed[] = [];
  for (const { candidate, position } of ordered) {
    if (taken.some((at) => Math.abs(at - position) < room)) continue;
    taken.push(position);
    out.push(candidate);
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Heavier first; between equals a real boundary before a landing. */
function outranks(a: Placed, b: Placed): boolean {
  return a.rank > b.rank || (a.rank === b.rank && !a.landing && b.landing);
}

/**
 * **A window is three readings of itself, and they are not
 * interchangeable.** Four bare numbers used to go into the grid arithmetic
 * and the code was correct only while everyone remembered which gave
 * phase, which gave membership, and which the density came from. Three
 * defects came from that: a narrowed edge chose the anchor's day and moved
 * a whole grid, measured the pixels and shrank the caller's spacing, and
 * judged emptiness and threw away a window holding one instant.
 *
 * So each reading is named, and each helper is handed only the one it
 * needs. This makes the roles legible; it does not make them unmixable,
 * because all three are still numbers underneath.
 */
/**
 * Where the axis begins, exactly as the caller gave it. **Phase hangs off
 * this** — which day a grid is anchored on is a property of the window
 * asked about, not of the instants a tick may occupy, and an edge half a
 * millisecond before a midnight belongs to the day before it.
 *
 * It is a shape rather than a number so that a membership bound cannot be
 * handed to a grid as its origin: that substitution moved a whole grid by
 * a day once, and read as ordinary code both times it was written. What
 * this cannot do is check that the origin was *derived* right — only
 * `windowOf` builds one, and tests are what hold it to that.
 */
interface PhaseOrigin {
  readonly epochMs: number;
}

interface TickWindow {
  readonly opensAt: PhaseOrigin;
  /**
   * The instants a tick may stand on: the caller's window with its edges
   * brought in to whole milliseconds, a clock being asked about whole
   * milliseconds and no finer. **Membership only.** A fraction left on an
   * edge is lost by the grid arithmetic anyway — added to an offset,
   * subtracted from an anchor, divided by a step — so a small enough one
   * stops existing and `[5e-324, 2000]` drew a tick at 0.
   */
  readonly holds: { readonly first: number; readonly last: number };
  /**
   * The least time between two ticks, in milliseconds. **Density only**,
   * and from the drawn window rather than the narrowed one, which would
   * hand the whole span to fewer milliseconds and quietly shrink the
   * distance the caller asked for.
   */
  readonly apart: number;
}

/** The window, or `null` where nothing can be drawn in it. */
function windowOf(
  fromMs: number,
  toMs: number,
  span: number,
  minTickSpacing: number,
): TickWindow | null {
  // Emptiness is the drawn window's question: one holding exactly one
  // whole millisecond, which `[999.5, 1000.5]` is, holds a tick.
  if (!(toMs > fromMs)) return null;
  const first = Math.ceil(fromMs);
  const last = Math.floor(toMs);
  if (last < first) return null;

  return {
    opensAt: { epochMs: fromMs },
    holds: { first, last },
    apart: (minTickSpacing * (toMs - fromMs)) / span,
  };
}

/** The tightest calendar rung that satisfies the minimum interval (ms), and every boundary it offers. */
function boundariesFor(window: TickWindow, zone: Zone): Candidate[] {
  const { holds, apart } = window;
  /**
   * **A step is picked by its name, and a calendar name is approximate.**
   * The day a clock moves forward is twenty-three hours long, February is
   * shorter than the thirty days the ladder has to call a month, and where
   * a clock jumped by hours two neighbouring boundaries can stand a third
   * of a step apart — a two-hour move leaves one hour between two
   * three-hour boundaries. So the name is not the promise: every boundary
   * the rung offers is a candidate, and the ones that would draw closer
   * than the caller asked for are chosen among afterwards, by weight.
   *
   * Advancing the ladder instead — picking a step by the shortest form it
   * can take — was measured to cost 37% of all labels, because a request
   * anywhere near a step's nominal length moves the whole chart up a rung.
   * Choosing among crowded boundaries costs nothing on ordinary requests
   * and one label in ninety on requests pinned exactly at a step's name.
   */
  for (const step of FIXED_STEPS) {
    // The fixed ladder is the only rung whose grid hangs off the window
    // rather than off the calendar, so it is the only one given `opensAt`.
    if (step >= apart) return fixedBoundaries(window.opensAt, holds, step, zone);
  }
  for (const months of MONTH_STEPS) {
    if (months * 30 * DAY >= apart) return monthBoundaries(holds, months, zone);
  }
  return yearBoundaries(holds, apart, zone);
}

/**
 * Second-to-week intervals — aligned to **midnight in that time zone**.
 * A week aligns to Monday midnight.
 *
 * **What the grid gives is the calendar's; what is drawn is decided
 * later.** How midnight and Monday become readings, how a clock's runs lay
 * a grid of them, and what a stretch the clock skipped is worth — those
 * are the calendar's, and live in `time/grid`. Nothing about pixels is
 * asked here: every point and landing the grid offers is a candidate, and
 * `place` chooses among them where they would crowd.
 */
function fixedBoundaries(
  opensAt: PhaseOrigin,
  holds: TickWindow["holds"],
  step: number,
  zone: Zone,
): Candidate[] {
  /**
   * **Phase comes from the window the caller gave.** Which day the grid
   * hangs off is a phase, and a window whose edge sits half a millisecond
   * before a midnight belongs to the day before it — narrowing that edge
   * up to the midnight moves the anchor a day, and a two-day rung then
   * draws the odd days where it drew the even ones.
   */
  let anchor = dayStartOf(zone, opensAt.epochMs);
  if (step === WEEK) anchor = weekStartOf(anchor);

  const out: Candidate[] = [];
  let last = Number.NEGATIVE_INFINITY;
  readingGrid(zone, anchor, step, holds.first, holds.last, {
    point(at) {
      // A landing that came to rest exactly on a grid reading names the
      // same instant as the point that follows it; the point is the one
      // kept, being the boundary itself.
      if (at === last && out[out.length - 1].landing) out.pop();
      else if (at <= last) return true;
      last = at;
      out.push({ at, landing: false });
      return out.length < MAX_BOUNDARIES;
    },
    landing(at) {
      if (at <= last) return true;
      last = at;
      out.push({ at, landing: true });
      return out.length < MAX_BOUNDARIES;
    },
  });
  return out;
}


function monthBoundaries(
  holds: TickWindow["holds"],
  step: number,
  zone: Zone,
): Candidate[] {
  const { first: minMs, last: maxMs } = holds;
  const out: Candidate[] = [];
  const parts = zone.parts(minMs);
  // Aligns to months that are multiples of step — a 3-month step lands on Jan/Apr/Jul/Oct.
  let year = parts.year;
  let month = Math.floor((parts.month - 1) / step) * step + 1;

  /**
   * **Only months a zone can be asked to read, at both ends.** Aligning
   * walks back within the year, and at the earliest instants a `Date`
   * holds there is nothing behind to walk into — its first instant falls
   * in an April, so that April is half outside and March wholly so.
   *
   * At the other end the loop asks about a month before it learns the
   * month is past the window, so the one after the last would be asked
   * about too. Both bounds are what a `Date` can hold rather than what the
   * window's edge reads, because **a local calendar reading can go
   * backwards**: Goose Bay entered November at 2009-11-01T03:00Z and
   * rolled back into October a minute later, so the window's end reads
   * October while November's boundary already happened inside it. The
   * window itself is judged below, on instants.
   */
  const earliest = new Date(-8.64e15);
  const latest = new Date(8.64e15);
  const firstYear = earliest.getUTCFullYear();
  const firstMonth = earliest.getUTCMonth() + 2;
  const lastYear = latest.getUTCFullYear();
  const lastMonth = latest.getUTCMonth() + 1;
  while (year < firstYear || (year === firstYear && month < firstMonth)) {
    month += step;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
  }

  for (let i = 0; i < MAX_BOUNDARIES; i++) {
    if (year > lastYear || (year === lastYear && month > lastMonth)) break;
    const ms = zone.toUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 });
    if (ms > maxMs) break;
    if (ms >= minMs) out.push({ at: ms, landing: false });
    month += step;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return out;
}

function yearBoundaries(
  holds: TickWindow["holds"],
  apart: number,
  zone: Zone,
): Candidate[] {
  const { first: minMs, last: maxMs } = holds;
  // 1·2·5×10ⁿ years — the numeric ladder returns only here (a year count is just a number).
  const rawYears = apart / (365 * DAY);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawYears, 1)));
  const normalized = rawYears / magnitude;
  const stepYears =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;

  const out: Candidate[] = [];
  /**
   * **Only Januarys a zone can be asked to read.** The alignment can land
   * below the window — a hundred-thousand-year step, which the whole range
   * a `Date` can hold asks for, lands a whole step below it — and down
   * there the answer is outside the range a `Date` holds at all. Which
   * January is the last unanswerable one is a fact about `Date`, not about
   * the window: its earliest instant falls in an April, so that April's
   * own January is already too early.
   */
  // Read here rather than at module load: a `new Date` standing in the
  // module body is a side effect, and a consumer who imports only a series
  // would carry this file for it.
  const firstJanuary = new Date(-8.64e15).getUTCFullYear() + 1;
  // And the far end bounded the same way — by what a `Date` can hold, not
  // by the year the window's last instant reads. A clock rolling back
  // across a new year leaves that reading in the old one while the new
  // year's boundary has already happened, as Phoenix did at
  // 1944-01-01T06:00Z. The window is judged below, on instants.
  const lastJanuary = new Date(8.64e15).getUTCFullYear();
  let year = Math.floor(zone.parts(minMs).year / stepYears) * stepYears;
  if (year < firstJanuary) {
    year += Math.ceil((firstJanuary - year) / stepYears) * stepYears;
  }
  for (let i = 0; i < MAX_BOUNDARIES && year <= lastJanuary; i++) {
    const ms = zone.toUtc({
      year,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    if (ms > maxMs) break;
    if (ms >= minMs) out.push({ at: ms, landing: false });
    year += stepYears;
  }
  return out;
}

/** Promoted labels — the biggest boundary a tick crosses picks the wording. */
class Labels {
  private readonly year: Intl.DateTimeFormat;
  private readonly month: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly time: Intl.DateTimeFormat;
  private readonly second: Intl.DateTimeFormat;

  private readonly beforeEra: Intl.DateTimeFormat;

  constructor(locale?: string, timeZone?: string) {
    this.year = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric" });
    this.beforeEra = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      era: "short",
    });
    this.month = new Intl.DateTimeFormat(locale, { timeZone, month: "short" });
    this.day = new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "numeric",
      day: "numeric",
    });
    this.time = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    this.second = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  /**
   * **Before year 1 the number alone names two years.** In the Gregorian
   * calendar a year formatted without its era is the year within that
   * era, so 1 BCE and 1 CE both come out "1", and every year before that
   * wears a positive number belonging to a later one — an axis drawn
   * across the boundary read 3, 2, 1, 1, 2, 3.
   *
   * So a year below 1 is formatted with the era asked for, and a year
   * from 1 on without it: a present-day axis holds no second year "2026"
   * could mean, and in English every ordinary year label would only be
   * wearing "AD".
   *
   * That is the whole rule. The year it turns on is the zone's, and
   * `Zone` reads its clock in one fixed locale, so the decision is
   * Gregorian whatever calendar the label's locale selects. What asking
   * for an era then does to a label in that calendar is not decided here.
   */
  private yearLabel(ms: number, parts: ZonedParts): string {
    return parts.year >= 1 ? this.year.format(ms) : this.beforeEra.format(ms);
  }

  /**
   * The basis for promotion isn't an exact boundary, it's the largest unit
   * that changed from the previous tick. On a weekly step, a tick may
   * never land on the 1st of the month — but "the month's first tick"
   * still needs to wear the month's name for the axis to read right.
   */
  of(ms: number, parts: ZonedParts, previous: ZonedParts | null): string {
    const midnight =
      parts.hour === 0 && parts.minute === 0 && parts.second === 0;

    if (previous === null) {
      // The first tick has nothing to compare against — it speaks at the level of its own boundary.
      if (midnight && parts.day === 1 && parts.month === 1) {
        return this.yearLabel(ms, parts);
      }
      if (midnight && parts.day === 1) return this.month.format(ms);
      if (midnight) return this.day.format(ms);
    } else if (parts.year !== previous.year) {
      return this.yearLabel(ms, parts);
    } else if (parts.month !== previous.month) {
      return this.month.format(ms);
    } else if (midnight || parts.day !== previous.day) {
      return this.day.format(ms);
    }

    if (parts.second === 0) return this.time.format(ms);
    return this.second.format(ms);
  }
}
