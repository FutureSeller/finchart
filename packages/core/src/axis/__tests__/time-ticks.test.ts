import { describe, expect, it } from "vitest";
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
  };
}

const ms = (iso: string) => Date.parse(iso);

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
