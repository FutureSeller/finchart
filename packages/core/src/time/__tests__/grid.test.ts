import { describe, expect, it } from "vitest";
import { dayStartOf, readingGrid, weekStartOf } from "../grid";
import { Zone } from "../zone";

interface Seen {
  readonly at: number;
  readonly landing: boolean;
}

/** Everything the walk names, in the order it names it, up to `limit`. */
function collect(zone: Zone, anchor: number, step: number, first: number, last: number, limit = 1000): Seen[] {
  const seen: Seen[] = [];
  readingGrid(zone, anchor, step, first, last, {
    point: (at) => seen.push({ at, landing: false }) < limit,
    landing: (at) => seen.push({ at, landing: true }) < limit,
  });
  return seen;
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const ms = (iso: string) => Date.parse(iso);

/** The reading an instant shows in that zone, in whole seconds. */
const readingAt = (zone: Zone, at: number) => zone.localOf(zone.parts(at));

describe("readingGrid — the grid a clock lays, one run at a time", () => {
  it("names each hour of an ordinary day once, ascending", () => {
    const zone = new Zone("Asia/Seoul");
    const first = ms("2026-03-04T00:00Z");
    const last = ms("2026-03-05T00:00Z");
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, last);

    expect(points).toHaveLength(25);
    expect(points.every((point) => !point.landing)).toBe(true);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].at - points[i - 1].at).toBe(HOUR);
    }
    expect(points[0].at).toBe(first);
  });

  it("keeps every point inside the instants asked for", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-03-08T04:30:00.5Z");
    const last = ms("2026-03-08T10:15Z");
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, last);

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.at).toBeGreaterThanOrEqual(first);
      expect(point.at).toBeLessThanOrEqual(last);
    }
  });

  /**
   * A fraction small enough stops existing in the grid arithmetic —
   * `5e-324 / 1000` is 0 — and a bound that vanishes would let a point
   * through that the window does not hold. The bounds are whole
   * milliseconds before anything is divided.
   */
  it("holds membership when an edge is a fraction that underflows", () => {
    const zone = new Zone("UTC");
    expect(collect(zone, 0, 1000, Number.MIN_VALUE, 2000).map((point) => point.at)).toEqual([1000, 2000]);
    expect(collect(zone, 0, 1000, 0, 1999.5).map((point) => point.at)).toEqual([0, 1000]);
    expect(collect(zone, 0, 1000, 999.5, 1000.5).map((point) => point.at)).toEqual([1000]);
    expect(collect(zone, 0, 1000, 1000.5, 1000.7)).toEqual([]);
  });

  /**
   * New York, 8 March 2026: the clock goes from 02:00 to 03:00. An hourly
   * grid stands on the reading 02:00, which never happened — so the
   * stretch is worth the instant the clock landed on, flagged, and the
   * reading 03:00 that names the same instant is not told twice.
   */
  it("tells a skipped stretch as one landing, and the grid reading it landed on as itself", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-03-08T05:00Z");
    const last = ms("2026-03-08T09:00Z");
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, last);

    expect(points).toEqual([
      { at: ms("2026-03-08T05:00Z"), landing: false }, // 00:00 EST
      { at: ms("2026-03-08T06:00Z"), landing: false }, // 01:00 EST
      // 02:00 skipped → landed exactly on 03:00 EDT, which the grid also stands on
      { at: ms("2026-03-08T07:00Z"), landing: true },
      { at: ms("2026-03-08T07:00Z"), landing: false }, // 03:00 EDT, told as itself too
      { at: ms("2026-03-08T08:00Z"), landing: false }, // 04:00 EDT
      { at: ms("2026-03-08T09:00Z"), landing: false }, // 05:00 EDT
    ]);
  });

  it("stands no flagged point where the skipped stretch held no grid reading", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-03-08T05:00Z");
    const last = ms("2026-03-08T11:00Z");
    // Every three hours: 00:00, 03:00, 06:00 — the skipped 02:00 is not on it.
    const points = collect(zone, dayStartOf(zone, first), 3 * HOUR, first, last);

    expect(points).toEqual([
      { at: ms("2026-03-08T05:00Z"), landing: false }, // 00:00 EST
      { at: ms("2026-03-08T07:00Z"), landing: false }, // 03:00 EDT — a real reading
      { at: ms("2026-03-08T10:00Z"), landing: false }, // 06:00 EDT
    ]);
  });

  /**
   * Monrovia, 7 January 1972: the clock moved forward forty-four and a
   * half minutes at midnight. A quarter-hour grid loses 00:00, 00:15 and
   * 00:30 to the stretch — one landing, not three — and picks up again at
   * the real 00:45.
   */
  it("gives a whole skipped stretch one point, at the landing", () => {
    const zone = new Zone("Africa/Monrovia");
    const first = ms("1972-01-07T00:30Z");
    const last = ms("1972-01-07T01:15Z");
    const points = collect(zone, dayStartOf(zone, first), 15 * MINUTE, first, last);

    expect(points).toEqual([
      { at: ms("1972-01-07T00:44:30Z"), landing: true },
      { at: ms("1972-01-07T00:45Z"), landing: false },
      { at: ms("1972-01-07T01:00Z"), landing: false },
      { at: ms("1972-01-07T01:15Z"), landing: false },
    ]);
  });

  /**
   * New York, 1 November 2026: the clock goes from 02:00 back to 01:00,
   * so 01:xx is shown twice. Each reading is on the grid once — its first
   * turn — and no instant is named twice.
   */
  it("names a repeated reading once, on its first turn", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-11-01T04:00Z"); // 00:00 EDT
    const last = ms("2026-11-01T08:00Z"); // 03:00 EST
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, last);

    const readings = points.map((point) => readingAt(zone, point.at));
    expect(new Set(readings).size).toBe(readings.length);
    expect(new Set(points.map((point) => point.at)).size).toBe(points.length);
    expect(points.every((point) => !point.landing)).toBe(true);
    // 01:00 is the EDT one; the EST 01:00 an hour later is not on the grid.
    expect(points.map((point) => point.at)).toEqual([
      ms("2026-11-01T04:00Z"),
      ms("2026-11-01T05:00Z"),
      ms("2026-11-01T07:00Z"), // 02:00 EST — after the repeat
      ms("2026-11-01T08:00Z"),
    ]);
  });

  /**
   * A window that opens on the landing itself. The run before the move is
   * outside the instants asked for, but a stretch is only known to have
   * been skipped by seeing the run on each side of it — so the runs are
   * asked for a day either side, and the point is still flagged.
   */
  it("still knows a landing when the window opens on it", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-03-08T07:00Z");
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, first + 2 * HOUR);

    expect(points[0]).toEqual({ at: first, landing: true });
  });

  it("leaves out a landing that falls before the window", () => {
    const zone = new Zone("America/New_York");
    const first = ms("2026-03-08T07:30Z");
    const points = collect(zone, dayStartOf(zone, first), HOUR, first, first + 2 * HOUR);

    expect(points.map((point) => point.at)).toEqual([ms("2026-03-08T08:00Z"), ms("2026-03-08T09:00Z")]);
    expect(points.every((point) => !point.landing)).toBe(true);
  });

  it("stops at the limit", () => {
    const zone = new Zone("UTC");
    const first = ms("2026-03-04T00:00Z");
    const points = collect(zone, dayStartOf(zone, first), MINUTE, first, first + 24 * HOUR, 7);

    expect(points).toHaveLength(7);
  });

  it("stands every unflagged point on the grid of readings", () => {
    for (const name of ["Asia/Seoul", "America/New_York", "Africa/Monrovia", "Europe/London"]) {
      const zone = new Zone(name);
      const first = ms("1972-01-06T12:00Z");
      const last = ms("1972-01-08T12:00Z");
      const anchor = dayStartOf(zone, first);
      for (const point of collect(zone, anchor, 15 * MINUTE, first, last)) {
        if (point.landing) continue;
        expect((readingAt(zone, point.at) - anchor) % (15 * MINUTE)).toBe(0);
      }
    }
  });
});

describe("dayStartOf / weekStartOf — where a grid's phase comes from", () => {
  it("reads midnight of the day the instant falls in, in that zone", () => {
    const zone = new Zone("Asia/Seoul");
    // 23:30Z on the 3rd is 08:30 on the 4th in Seoul.
    const midnight = dayStartOf(zone, ms("2026-03-03T23:30Z"));
    expect(midnight).toBe(zone.localOf({ year: 2026, month: 3, day: 4, hour: 0, minute: 0, second: 0 }));
  });

  it("takes an instant just before the epoch to the day that ended there", () => {
    const zone = new Zone("UTC");
    expect(dayStartOf(zone, -0.5)).toBe(-24 * HOUR);
    expect(dayStartOf(zone, 0)).toBe(0);
  });

  it("walks a midnight reading back to its Monday", () => {
    const DAY = 24 * HOUR;
    const thursday = 0; // the epoch
    expect(weekStartOf(thursday)).toBe(-3 * DAY);
    expect(weekStartOf(-3 * DAY)).toBe(-3 * DAY); // a Monday is its own
    expect(weekStartOf(4 * DAY)).toBe(4 * DAY); // the Monday after
    expect(weekStartOf(-4 * DAY)).toBe(-10 * DAY); // Sunday before → the Monday before that
  });
});
