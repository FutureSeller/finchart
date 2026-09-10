import { ContractError, describe } from "../primitives";
import { LAST_INSTANT } from "./zone";

/**
 * What every producer asks of an x before it does anything of its own: a
 * number, down to the millisecond, and an instant a `Date` can hold. It is
 * a pre-check, not the whole door. **How far in a producer can be asked is
 * the producer's own** — a session asks a clock about the midnight two
 * days out and stops three days inside, a fixed grid asks no clock
 * anything and reaches the edge — and each says so itself, because a
 * shared limit would be one producer's lent to the others.
 */
export function requireInstant(ms: number, label: string): number {
  /**
   * **A number first, and only then a millisecond.** `Math.floor` takes
   * `null`, `"0"`, `false` and `[]` to zero, so flooring before asking
   * would turn a value that is not an instant at all into the epoch —
   * laundering a malformed x into a well-formed bar, which is the very
   * thing the door is here to stop.
   */
  if (!Number.isFinite(ms)) {
    throw new ContractError(`${label} needs a finite number of milliseconds, got ${describe(ms)}`);
  }
  /**
   * Then down to the millisecond. A clock is read through `Date`, which
   * holds nothing finer, and which bar holds an instant does not change
   * within one — so the millisecond beneath is the answer rather than a
   * refusal. Sub-millisecond precision carried as a fraction is a real
   * thing and the data door lets it through; refusing it here would fail
   * deep inside a fold or an indicator instead.
   */
  const whole = Math.floor(ms);
  if (!isInstant(whole)) {
    throw new ContractError(`${label} needs an instant a Date can hold, got ${describe(ms)}`);
  }
  return whole;
}

/**
 * True where a value is an instant at all: a whole millisecond that a
 * `Date` can hold. **The answers are whole milliseconds**, so this is what
 * an answer is checked against. A fraction handed *in* is taken down to
 * the millisecond beneath it before anything reads a clock — down, not
 * toward zero, which is what `Date` would do and what would put half a
 * millisecond before the epoch into the day that had not started yet.
 */
export function isInstant(ms: number): boolean {
  return Number.isInteger(ms) && Math.abs(ms) <= LAST_INSTANT;
}

/**
 * **Where a bar starts is one function**: given an instant, the instant
 * the bar holding it opened at.
 *
 * Three laws are the contract, and every producer here is guarded against
 * all three:
 *
 * - **idempotent** — `f(f(ms)) === f(ms)`. A bar's start is its own bar's
 *   start.
 * - **monotonic** — `a <= b` implies `f(a) <= f(b)`.
 * - **backward only** — `f(ms) <= ms`.
 *
 * They hold for every instant a producer answers for, and the answer is
 * one of those instants too — so the laws can be applied again to it. A
 * producer refuses anything else with a contract error rather than
 * returning a number the laws are not true of; `NaN` is the case that
 * would otherwise pass silently through all three.
 *
 * **Where a producer stops is a property of its grid, not one number.**
 * Near the beginning of the reach the bar holding an instant can have
 * begun outside it, so it has no start these answers can name — a
 * perfectly good `Date`, and still not one of them. Only that end: an
 * answer never runs forward, so it cannot leave by the other. And
 * how far that reaches in depends on how wide the bars are and, for a
 * session, on how far the zone stands from UTC. A producer refuses there
 * rather than answering with a number outside the set; otherwise
 * idempotence would be false exactly where it is hardest to notice. No
 * chart reaches those instants; the law is what makes them worth
 * refusing.
 *
 * One useful check falls out of them for a consumer: `f(bar.x) === bar.x`
 * says a page of history stands on the same grid the chart is drawing.
 * Run it over a REST response and a mismatched grid shows up at once.
 *
 * **The laws say where a bar begins, not that bars go anywhere.** A
 * function returning the same instant forever keeps all three and means
 * one bar that never ends. Nothing here needs more than that; a consumer
 * paging history on a cursor would.
 *
 * A week, a month, a quarter, or a session that crosses midnight is a few
 * lines of a consumer's own `BarStart` — the calendar of every venue is
 * not something a charting library can ship.
 */
export type BarStart = (ms: number) => number;
