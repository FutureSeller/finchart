import { sessionStart } from "@finchart/core";

const HOUR = 60 * 60 * 1000;

/**
 * The instant a calendar date's session opens in a market's zone — what a
 * "go to date" box needs on a daily chart. `date` is `YYYY-MM-DD`, a year
 * from 0001 to 9999 on the Gregorian calendar; a date that is not one, or
 * that the zone skipped (Samoa went from 29 to 31 December 2011), throws.
 */
export function sessionOfDate(date: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`${date} is not YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // setUTCFullYear, not Date.UTC — Date.UTC reads the years 0–99 as 1900–1999.
  const midnight = new Date(0);
  midnight.setUTCFullYear(year, month - 1, day);
  midnight.setUTCHours(0, 0, 0, 0);
  // A date the calendar rolls over (February 30th) comes back as another.
  const onCalendar =
    midnight.getUTCFullYear() === year && midnight.getUTCMonth() === month - 1 && midnight.getUTCDate() === day;
  if (year < 1 || !onCalendar) throw new RangeError(`${date} is not a date from 0001 to 9999`);

  // The zone's own reading of an instant, as numbers — a formatted string
  // differs between runtimes, the parts do not.
  const reader = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const readsAsDate = (at: number): boolean => {
    const parts = reader.formatToParts(at);
    const part = (type: string) => Number(parts.find((each) => each.type === type)?.value);
    return part("year") === year && part("month") === month && part("day") === day;
  };

  // No zone has been more than 16 hours off UTC, so the date begins after
  // UTC midnight −16h and ends before +40h. A step of an hour lands inside
  // every date that lasts an hour or more — the shortest on record is 14.
  // One instant inside the date is enough: sessionStart finds where it opened.
  for (let hour = -16; hour <= 40; hour++) {
    const at = midnight.getTime() + hour * HOUR;
    if (readsAsDate(at)) return sessionStart({ timeZone })(at);
  }
  throw new RangeError(`${date} never happened in ${timeZone}`);
}
