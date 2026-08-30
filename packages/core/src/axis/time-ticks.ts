import type { TickStrategy } from "./types";

/**
 * The time-tick strategy. Places ticks at calendar boundaries instead of
 * multiples of 1·2·5×10ⁿ — the start of a minute or hour, midnight,
 * Monday, the 1st of the month, January 1st. A tick that crosses a bigger
 * boundary gets a promoted label: the first tick of a month reads "Mar",
 * the first of a year reads "2026".
 *
 * Time zone and locale are handled with `Intl` alone — no date library
 * dependency. Boundary arithmetic reads that zone's wall-clock parts via
 * `formatToParts` and corrects back with iteration.
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

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function timeTicks(options: TimeTicksOptions = {}): TickStrategy {
  const epochOf = options.epochOf ?? ((x: number) => x);
  const xOfEpoch = options.xOfEpoch ?? ((ms: number) => ms);
  const zone = new Zone(options.timeZone);
  const labels = new Labels(options.locale, options.timeZone);

  return {
    ticks({ min, max, span, minTickSpacing, xOf, domainOf }) {
      if (!(max > min) || !(span > 0)) return [];

      const minMs = epochOf(xOf(min));
      const maxMs = epochOf(xOf(max));
      if (!(maxMs > minMs)) return [];

      const pxPerMs = span / (maxMs - minMs);
      const boundaries = boundariesFor(
        minMs,
        maxMs,
        minTickSpacing / pxPerMs,
        zone,
      );

      let previous: ZonedParts | null = null;
      return boundaries.map((ms) => {
        const parts = zone.parts(ms);
        const label = labels.of(ms, parts, previous);
        previous = parts;
        return { value: domainOf(xOfEpoch(ms)), label };
      });
    },
  };
}

/** The tightest calendar boundaries that satisfy the minimum interval (ms). */
function boundariesFor(
  minMs: number,
  maxMs: number,
  minStepMs: number,
  zone: Zone,
): number[] {
  for (const step of FIXED_STEPS) {
    if (step >= minStepMs) return fixedBoundaries(minMs, maxMs, step, zone);
  }
  for (const months of MONTH_STEPS) {
    if (months * 30 * DAY >= minStepMs) {
      return monthBoundaries(minMs, maxMs, months, zone);
    }
  }
  return yearBoundaries(minMs, maxMs, minStepMs, zone);
}

/**
 * Second-to-week intervals — aligned to **midnight in that time zone**.
 * A week aligns to Monday midnight.
 *
 * The offset can shift at a DST boundary, so this corrects it back at
 * every tick — midnight is still midnight even on a 23- or 25-hour day.
 */
function fixedBoundaries(
  minMs: number,
  maxMs: number,
  step: number,
  zone: Zone,
): number[] {
  const out: number[] = [];
  const parts = zone.parts(minMs);
  // Starting anchor: for a week, that week's Monday midnight; otherwise that day's midnight.
  let anchor = zone.toUtc({ ...parts, hour: 0, minute: 0, second: 0 });
  if (step === WEEK) {
    // Mimics Date.getUTCDay — reading anchor as UTC gives the weekday in that zone.
    const weekday = new Date(anchor + zone.offsetAt(anchor)).getUTCDay();
    const sinceMonday = (weekday + 6) % 7;
    anchor -= sinceMonday * DAY;
  }

  // Drop the fractional step before midnight, start from the first boundary at or after min.
  let local = zone.toLocal(anchor);
  const localMin = zone.toLocal(minMs);
  local += Math.ceil((localMin - local) / step) * step;

  for (; out.length < 1000; local += step) {
    const ms = zone.toUtcMs(local);
    if (ms > maxMs) break;
    if (ms >= minMs) out.push(ms);
  }
  return out;
}

function monthBoundaries(
  minMs: number,
  maxMs: number,
  step: number,
  zone: Zone,
): number[] {
  const out: number[] = [];
  const parts = zone.parts(minMs);
  // Aligns to months that are multiples of step — a 3-month step lands on Jan/Apr/Jul/Oct.
  let year = parts.year;
  let month = Math.floor((parts.month - 1) / step) * step + 1;

  for (let i = 0; i < 1000; i++) {
    const ms = zone.toUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 });
    if (ms > maxMs) break;
    if (ms >= minMs) out.push(ms);
    month += step;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return out;
}

function yearBoundaries(
  minMs: number,
  maxMs: number,
  minStepMs: number,
  zone: Zone,
): number[] {
  // 1·2·5×10ⁿ years — the numeric ladder returns only here (a year count is just a number).
  const rawYears = minStepMs / (365 * DAY);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawYears, 1)));
  const normalized = rawYears / magnitude;
  const stepYears =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;

  const out: number[] = [];
  let year = Math.floor(zone.parts(minMs).year / stepYears) * stepYears;

  for (let i = 0; i < 1000; i++) {
    const ms = zone.toUtc({
      year,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    if (ms > maxMs) break;
    if (ms >= minMs) out.push(ms);
    year += stepYears;
  }
  return out;
}

/** Time zone arithmetic — with `Intl.formatToParts` and iterative correction, no library needed. */
class Zone {
  private readonly dtf: Intl.DateTimeFormat;

  constructor(timeZone?: string) {
    this.dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  parts(ms: number): ZonedParts {
    const parts: Record<string, number> = {};
    for (const { type, value } of this.dtf.formatToParts(ms)) {
      if (type !== "literal") parts[type] = Number(value);
    }
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      // Some environments render midnight as 24 with hour12:false.
      hour: parts.hour === 24 ? 0 : parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  }

  /** Wall-clock parts in that zone → UTC ms. Two rounds of correction handle DST too. */
  toUtc(parts: ZonedParts): number {
    const wanted = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    let guess = wanted;
    for (let i = 0; i < 2; i++) {
      const seen = this.parts(guess);
      const asUtc = Date.UTC(
        seen.year,
        seen.month - 1,
        seen.day,
        seen.hour,
        seen.minute,
        seen.second,
      );
      if (asUtc === wanted) break;
      guess += wanted - asUtc;
    }
    return guess;
  }

  /** UTC offset (ms) at this timestamp. wall clock = UTC + offset. */
  offsetAt(ms: number): number {
    const seen = this.parts(ms);
    return (
      Date.UTC(
        seen.year,
        seen.month - 1,
        seen.day,
        seen.hour,
        seen.minute,
        seen.second,
      ) - ms
    );
  }

  /** Coordinates on the wall-clock axis — fixed-interval steps walk along this axis. */
  toLocal(ms: number): number {
    return ms + this.offsetAt(ms);
  }

  toUtcMs(local: number): number {
    // Assumes the offset is stable nearby and corrects once — only the
    // extreme case where a tick lands right on a DST transition can drift
    // by one step.
    return local - this.offsetAt(local);
  }
}

/** Promoted labels — the biggest boundary a tick crosses picks the wording. */
class Labels {
  private readonly year: Intl.DateTimeFormat;
  private readonly month: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly time: Intl.DateTimeFormat;
  private readonly second: Intl.DateTimeFormat;

  constructor(locale?: string, timeZone?: string) {
    this.year = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric" });
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
        return this.year.format(ms);
      }
      if (midnight && parts.day === 1) return this.month.format(ms);
      if (midnight) return this.day.format(ms);
    } else if (parts.year !== previous.year) {
      return this.year.format(ms);
    } else if (parts.month !== previous.month) {
      return this.month.format(ms);
    } else if (midnight || parts.day !== previous.day) {
      return this.day.format(ms);
    }

    if (parts.second === 0) return this.time.format(ms);
    return this.second.format(ms);
  }
}
