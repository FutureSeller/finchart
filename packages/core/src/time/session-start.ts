import { ContractError, requireObject } from "../primitives";
import { isInstant, requireInstant, type BarStart } from "./bar-start";
import { Zone } from "./zone";

/**
 * Where a session starts, for a market whose session is a calendar day in
 * one place.
 *
 * **The time zone is required, and the reason is that this decides an x
 * that gets stored.** A tick strategy's zone decides where its boundaries
 * fall and what they read, and a wrong one is wrong on the screen where it
 * can be seen and changed; this one decides where a bar begins,
 * and that number is written into a drawing's coordinates and into a
 * history cursor. A default would let a server rendering in UTC and a
 * browser in Seoul disagree about the same bar.
 *
 * **A session opens at its earliest real instant, not at midnight.** Where
 * a clock jumped over midnight the day opens an hour late, and where it
 * ran through midnight twice the day opens at the first of the two — so
 * that asking a session's own start returns it unchanged, everywhere and
 * every year.
 *
 * Only "a session is a calendar day" lives here. A holiday, a half day,
 * or an open that crosses midnight is the app's knowledge, and this is the
 * tool to write it with.
 */
export function sessionStart(options: { timeZone: string }): BarStart {
  requireObject(options, "sessionStart(options)");
  if (typeof options.timeZone !== "string" || options.timeZone === "") {
    throw new ContractError(
      "sessionStart needs a time zone — it decides where a bar starts, and that x is stored",
    );
  }
  const zone = new Zone(options.timeZone);

  // One session's half-open stretch. Reading a clock is what costs here, so
  // consecutive bars inside a session answer on two comparisons. A daily
  // bar never hits it — one bar per session is one miss per session — and
  // that is the shape of the thing, not a hole in it.
  let from = Number.NaN;
  let until = Number.NaN;

  return (ms) => {
    // Before the cache, not after. A refused instant can still fall inside
    // the stretch a previous call wrote, and answering it from there would
    // make the same reader accept what a new one refuses.
    const at = requireInstant(ms, "sessionStart");
    if (at >= from && at < until) return from;

    const midnight = { ...zone.parts(at), hour: 0, minute: 0, second: 0 };
    /**
     * **The day's earliest real instant, which is not always its midnight
     * resolved.** A jump that begins before midnight and lands after it —
     * Toronto went from the 30th's 23:30 to the 31st's 00:30 in 1919 —
     * leaves that midnight inside the jump rather than at its start, and
     * resolving it answers later than the day began. A session opened
     * there would start after instants that belong to it.
     */
    let opened = zone.firstFrom(zone.localOf(midnight));
    // The day after, written as a day past the end of this one — a reading
    // is counted in days, and the count carries the overflow into the next
    // month or year itself. A month-length table here would be twelve
    // lines that never change an answer.
    let ends = zone.firstFrom(zone.localOf({ ...midnight, day: midnight.day + 1 }));

    /**
     * **A clock that moves back across midnight replays a date.** Casey
     * put its clock back three hours at local 02:00 on 5 March 2010, so
     * the reading returned to the 4th and ran through that evening again.
     * The date a reading names is therefore not in the order the instants
     * are, and taking it at face value would answer an *earlier* session
     * for a *later* instant.
     *
     * The session is the last one to have opened, so where the next day's
     * open has already happened, that is the answer.
     */
    if (ends <= at) {
      opened = ends;
      ends = zone.firstFrom(zone.localOf({ ...midnight, day: midnight.day + 2 }));
    }

    /**
     * **A session that opened outside the reach is refused, not answered.**
     * Near the first instants this answers for, the day containing one
     * began a day earlier still — outside the set these answers come from,
     * though a `Date` holds it perfectly well. Returning it would make idempotence false where
     * nothing would notice: asking again would land on an instant the
     * producer does not answer for.
     */
    if (!isInstant(opened)) {
      throw new ContractError(
        `sessionStart: the session holding ${ms} opened at ${opened}, outside the reach a bar start answers for`,
      );
    }

    // Both at once, once the answer is whole. Written one at a time, a
    // throw between them would leave a new opening beside the old ending,
    // and a later instant could fall inside that stretch and be answered
    // with a session it does not belong to.
    from = opened;
    until = ends;
    return from;
  };
}
