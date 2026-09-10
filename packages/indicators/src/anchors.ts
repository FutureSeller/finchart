import { type BarStart, ContractError, type OHLC } from "@finchart/core";
import type { AnchorPredicate } from "./factories";

/**
 * Opens a period on the bar that begins a new one, for whatever a period
 * is — `periodAnchor({ barStart })` turns any rule about where a bar
 * starts into the `anchor` that `vwap` and `pivotPoints` take.
 *
 * **The app owns its calendar; it should not also own the comparison.**
 * "Did a new period open here" is the same mechanical question whatever
 * the calendar is: ask where this bar's period began, ask where the last
 * one's did, and see whether they differ. That machinery is here so a
 * venue with its own rule writes the rule and nothing else.
 *
 * **The rule is reusable, but it is not the same rule twice.** A
 * `BarStart` handed to `barAggregator` says how wide a candle is; one
 * handed here says how long an indicator accumulates before it resets.
 * Those are usually different periods, and passing the aggregator's — a
 * minute, say — resets VWAP on every bar it drew, which is VWAP of one
 * bar. It is the same machinery, deliberately; it is not the same
 * argument.
 *
 * **The bug this exists for**: a New York session opens at 05:00Z, and the
 * `x % 86_400_000 === 0` predicate that every example used to carry asks
 * about UTC midnight instead, and whether any bar even lands there is an
 * accident of the tape. Where none does — daily or six-hourly bars from
 * that 05:00Z opening never do — the predicate is true of nothing and VWAP
 * accumulates across every session there has ever been. Where one does —
 * hourly bars from the same opening land on it, the hour between them
 * dividing that five-hour offset evenly — it is true once a day, in the
 * middle of a session, resetting VWAP at a place no trader would
 * recognise. Neither failure announces itself, and which one a tape gets
 * depends on whether it holds a midnight-UTC bar at all. A clock that
 * moves is not a new period either, which is the other half of what a
 * modulo cannot say.
 *
 * The first bar opens a period because there is nothing behind it to
 * compare against. `vwap` asks about index 0 and `pivotPoints` does not —
 * both are right, and this answers the same either way. **What this reads
 * of a bar it reads when it is called**, so a tape of one bar drawn
 * through `pivotPoints`, which opens its first period without asking, is
 * never read at all.
 *
 * A bar's x goes to the `BarStart` as it is: what an x means, which
 * instants it answers for, and what it refuses are that producer's to say.
 * Core's `sessionStart` reads epoch milliseconds and calls a period a
 * calendar day in one place.
 */
export function periodAnchor(options: { barStart: BarStart }): AnchorPredicate {
  if (typeof options !== "object" || options === null) {
    throw new ContractError(`periodAnchor(options) must be an object, got ${typeof options}`);
  }
  const { barStart } = options;
  // Checked here rather than at the first bar: a missing `barStart` would
  // otherwise surface as a `TypeError` inside an indicator's recomputation,
  // a long way from the call that got it wrong.
  if (typeof barStart !== "function") {
    throw new ContractError(
      `periodAnchor needs a barStart function, got ${typeof barStart}`,
    );
  }

  return (point: OHLC, _index: number, previous: OHLC | null): boolean => {
    // The bar behind first, so the one slot a bar start may keep ends on
    // the period this bar is in — which is the period the next bar will
    // ask about. Asking about this bar first leaves that slot a step
    // behind and every bar of a daily tape misses twice instead of once.
    if (previous !== null) return barStart(previous.x) !== barStart(point.x);
    // Nothing behind, and the producer's door still has to be met: an x it
    // cannot answer for is refused on the first bar as much as on any other.
    barStart(point.x);
    return true;
  };
}
