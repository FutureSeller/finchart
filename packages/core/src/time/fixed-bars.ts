import { ContractError, requireObject, requirePositive } from "../primitives";
import { isInstant, requireInstant, type BarStart } from "./bar-start";

/** Past a day the epoch is the wrong ruler — an epoch-aligned week begins on a Thursday. */
const WIDEST_FIXED_BAR = 24 * 60 * 60 * 1000;

/**
 * Bars of a fixed width, aligned to the epoch — the minute, hour and
 * four-hour bars of a market that never closes.
 *
 * **The width is a whole number of milliseconds, and at most a day.** The
 * lower bound is arithmetic: below a millisecond the division runs to
 * infinity and the answer stands ahead of its own instant. The upper one
 * is a decision, not a necessity — a two-day epoch grid keeps all three
 * laws perfectly well, but the epoch is the wrong thing to align it to,
 * since an epoch-aligned week begins on a Thursday. A grid wider than a
 * day is a few lines of the consumer's own `BarStart`, written against
 * whatever it should actually align to.
 *
 * A calendar day is not this function's answer even where it happens to
 * be 86,400,000 ms wide: the day a clock moves is shorter or longer than
 * the others, and an epoch-aligned grid would cut it in the wrong place.
 * Ask `sessionStart` for a day.
 */
export function fixedBars(options: { interval: number }): BarStart {
  requireObject(options, "fixedBars(options)");
  const interval = requirePositive(options.interval, "fixedBars interval");
  if (!Number.isInteger(interval) || interval > WIDEST_FIXED_BAR) {
    throw new ContractError(
      `fixedBars interval must be a whole number of milliseconds up to a day (${WIDEST_FIXED_BAR}), got ${interval}`,
    );
  }

  return (ms) => {
    const at = requireInstant(ms, "fixedBars");
    const start = Math.floor(at / interval) * interval;
    if (!isInstant(start)) {
      throw new ContractError(
        `fixedBars: the bar holding ${ms} began at ${start}, outside the reach a bar start answers for`,
      );
    }
    return start;
  };
}
