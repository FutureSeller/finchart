/**
 * The time zones guide's "go to date" recipe is code a reader copies, so it
 * runs here against the zones that break the easy versions of it: offsets
 * past ±12 hours, a clock that moves at midnight, dates a zone skipped, and
 * the years `Date.UTC` rewrites.
 */
import { describe, expect, it } from "vitest";
import { sessionOfDate } from "../session-of-date";

function localDate(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

describe("sessionOfDate", () => {
  const found: Array<[date: string, timeZone: string]> = [
    ["2026-07-01", "Asia/Seoul"],
    ["2026-01-15", "America/New_York"],
    ["2026-07-15", "America/New_York"],
    ["2026-03-08", "America/New_York"],
    ["2026-11-01", "America/New_York"],
    ["2026-09-27", "Pacific/Auckland"],
    ["2026-04-05", "Pacific/Auckland"],
    ["2026-10-04", "Pacific/Norfolk"],
    ["2026-07-01", "Pacific/Kiritimati"],
    ["2026-07-01", "Pacific/Pago_Pago"],
    ["2026-07-01", "Etc/GMT+12"],
    ["2026-09-06", "America/Santiago"],
    ["2026-10-04", "Australia/Lord_Howe"],
    ["1844-06-01", "Asia/Manila"],
    ["1860-06-01", "America/Metlakatla"],
    ["1948-03-25", "Antarctica/Macquarie"],
    ["0099-01-01", "America/New_York"],
    ["0001-01-01", "UTC"],
    ["9999-12-31", "UTC"],
  ];

  it.each(found)("opens %s in %s at that date's earliest instant", (date, timeZone) => {
    const start = sessionOfDate(date, timeZone);
    expect(localDate(start, timeZone)).toBe(date);
    expect(localDate(start - 1, timeZone)).not.toBe(date);
  });

  it("lands on the instants a market's clock says", () => {
    expect(sessionOfDate("2026-07-01", "Asia/Seoul")).toBe(Date.parse("2026-06-30T15:00:00Z"));
    // Midnight comes before the clock moves, at the offset of the day before.
    expect(sessionOfDate("2026-03-08", "America/New_York")).toBe(Date.parse("2026-03-08T05:00:00Z"));
    expect(sessionOfDate("2026-11-01", "America/New_York")).toBe(Date.parse("2026-11-01T04:00:00Z"));
    // Santiago's clock skips from midnight to 01:00, so the day opens at 01:00 (UTC−3).
    expect(sessionOfDate("2026-09-06", "America/Santiago")).toBe(Date.parse("2026-09-06T04:00:00Z"));
    // Kiritimati is UTC+14: its July 1st begins on June 30th in UTC.
    expect(sessionOfDate("2026-07-01", "Pacific/Kiritimati")).toBe(Date.parse("2026-06-30T10:00:00Z"));
  });

  it("refuses a date the zone skipped, and says so", () => {
    expect(() => sessionOfDate("2011-12-30", "Pacific/Apia")).toThrow(new RangeError("2011-12-30 never happened in Pacific/Apia"));
    expect(() => sessionOfDate("1844-12-31", "Asia/Manila")).toThrow(new RangeError("1844-12-31 never happened in Asia/Manila"));
  });

  // Each of these would also fail the zone's reading; the message is what
  // tells a typo from a date the zone never had.
  it("refuses what is not a date from 0001 to 9999 as not a date", () => {
    expect(() => sessionOfDate("2026-02-30", "UTC")).toThrow(new RangeError("2026-02-30 is not a date from 0001 to 9999"));
    expect(() => sessionOfDate("0000-02-29", "UTC")).toThrow(new RangeError("0000-02-29 is not a date from 0001 to 9999"));
    expect(() => sessionOfDate("2026-13-01", "UTC")).toThrow(new RangeError("2026-13-01 is not a date from 0001 to 9999"));
    for (const date of ["2026-7-1", " 2026-07-01", "26-07-01"]) {
      expect(() => sessionOfDate(date, "UTC")).toThrow(new RangeError(`${date} is not YYYY-MM-DD`));
    }
  });
});
