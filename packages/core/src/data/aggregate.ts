import { ContractError, requireFinite, requireObject } from "../primitives";
import type { BarStart } from "../time";
import { isGap } from "./accessors";
import type { OHLC } from "./types";

/** One execution off a live feed. `volume` is optional, and `null` is a gap. */
export interface Trade {
  x: number;
  price: number;
  volume?: number | null;
}

/**
 * Folds a stream of trades into bars.
 *
 * **`fold` is the primitive and `reduce` is a wrapper over it.** An
 * imperative consumer holds the bar in progress and pushes:
 * `feed.push(agg.fold(current, trade))` — no array is copied per trade. A
 * consumer holding state instead writes `setBars(prev => agg.reduce(prev,
 * trade))`.
 *
 * **What it does not do is half the contract:**
 *
 * - **One trade makes at most one bar.** A reconnection that skipped a
 *   stretch is `handle.append`'s business — if one call made two bars, the
 *   `updateLast` that follows would drop the one in the middle.
 * - **A trade already past comes back as the same object.** "I did not eat
 *   this" is said with identity, so a consumer writes `if (next === prev)
 *   return;` rather than paying a copy per rejected tick.
 * - **The close is the last to arrive, not the last to have happened.**
 *   Given one trade and the bar so far, a pure reducer never learns when
 *   the trade that set the close occurred. Ordering inside a bar belongs
 *   to the feed.
 * - **Aggregate first, conflate after.** Conflating raw trades merges them
 *   last-wins and throws away that frame's high and low.
 * - **It is a door, because folding erases what it is handed.** A price
 *   that is not a number loses every comparison it is in, so it neither
 *   raises the high nor lowers the low and only lands on the close — where
 *   the next trade overwrites it. Its volume is already in the sum by
 *   then, so what reaches the data door is a bar that adds up wrong and
 *   looks perfectly well formed. Nothing downstream can refuse what it
 *   never sees, so a trade's own numbers are checked here.
 *
 * It seeds from an empty array rather than refusing one — a consumer with
 * no history would otherwise never start. The bar that opens that way has
 * the session's first trade for an open, not the session's opening price,
 * and its x is not a cursor any server has heard of.
 */
export function barAggregator(options: { barStart: BarStart }): {
  /** Folds one trade into the bar in progress. No array involved. */
  fold(bar: OHLC | null, trade: Trade): OHLC;
  /** That fold over an array — the front keeps its object identity. */
  reduce(bars: OHLC[], trade: Trade): OHLC[];
} {
  requireObject(options, "barAggregator(options)");
  const { barStart } = options;
  // Checked here rather than at the first trade: a missing `barStart` would
  // otherwise surface as a `TypeError` deep in a feed handler, a long way
  // from the call that got it wrong.
  if (typeof barStart !== "function") {
    throw new ContractError(
      `barAggregator needs a barStart function, got ${typeof barStart}`,
    );
  }

  const fold = (bar: OHLC | null, trade: Trade): OHLC => {
    requireObject(trade, "barAggregator fold(trade)");
    requireFinite(trade.price, "a trade's price");
    // A gap is a volume a feed did not send; `NaN` is one it got wrong,
    // and adding it would poison every bar after it too.
    if (!isGap(trade.volume)) requireFinite(trade.volume, "a trade's volume");
    requireFinite(trade.x, "a trade's x");

    /**
     * **A bar start is a collaborator, and this one is the consumer's to
     * write.** The two shipped here refuse what they cannot answer for,
     * but `x => Math.floor(x / 60000) * 60000` is five characters short of
     * that and returns `NaN` for one — which loses both comparisons below,
     * lands in the same-bar branch, and adds the trade's volume to a bar
     * the trade never belonged to. The trade disappears and its volume
     * stays, which is the one shape of failure this fold must not have.
     */
    const x = barStart(trade.x);
    if (!Number.isFinite(x)) {
      throw new ContractError(
        `barAggregator: the barStart answered ${x} for a trade at ${trade.x}, which is no bar to fold into`,
      );
    }

    // Older than the bar in progress: folding it would rewrite what the
    // consumer has already drawn, so nothing happens and the identity says so.
    if (bar !== null && x < bar.x) return bar;

    if (bar === null || x > bar.x) {
      const opened: OHLC = {
        x,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
      };
      if (!isGap(trade.volume)) opened.volume = trade.volume;
      return opened;
    }

    /**
     * Sum only what is there, and leave the key off if none of it was —
     * so a bar folded from trades has the same shape as one the
     * aggregation merges, and the core answers one question one way.
     *
     * **The bar folded into can carry a gap of its own**, because live
     * folding resumes from a history bar and `volume: null` is valid
     * there. Spreading it would keep that `null` where a merge drops the
     * key, which is the same question answered two ways.
     */
    const carried = isGap(bar.volume) ? undefined : bar.volume;
    const added = isGap(trade.volume) ? undefined : trade.volume;
    const volume = added === undefined ? carried : (carried ?? 0) + added;
    // Two finite volumes can still add to one that is not. The sum is what
    // the bar carries, so the sum is what has to be a number — a bar with
    // an infinite volume is refused by the data door, and every trade
    // folded after it would carry the same infinity.
    if (volume !== undefined && !Number.isFinite(volume)) {
      throw new ContractError(
        `barAggregator: a trade's volume took the bar's to ${volume}, which is no volume`,
      );
    }

    // Built the way the merge builds one, rather than spread — the fields
    // it does not name are the fields a merged bar does not carry either.
    const next: OHLC = {
      x: bar.x,
      open: bar.open,
      high: trade.price > bar.high ? trade.price : bar.high,
      low: trade.price < bar.low ? trade.price : bar.low,
      close: trade.price,
    };
    if (bar.label !== undefined) next.label = bar.label;
    if (volume !== undefined) next.volume = volume;
    return next;
  };

  return {
    fold,
    reduce(bars, trade) {
      const last = bars.length === 0 ? null : bars[bars.length - 1];
      const next = fold(last, trade);

      if (next === last) return bars;
      if (last !== null && next.x === last.x) {
        // Every bar in front is the same object, which is what lets the
        // change be read as a replace of one rather than a whole new array.
        const swapped = bars.slice(0, -1);
        swapped.push(next);
        return swapped;
      }
      return [...bars, next];
    },
  };
}
