/**
 * Data playback — one place owns the tape's current time and its settled bars.
 *
 * Live ticks and timeframe switches touch the same state (clock, tickIndex,
 * minutes), so this closure is the single hand on it rather than a scattering
 * of `let`s. The surface is only as wide as the showcase uses — no
 * generalizing into a subscription system.
 */
import type { OHLC } from "@finchart/core";
import {
  aggregate,
  buildTape,
  HISTORY_MINUTES,
  intraTick,
  TICKS_PER_MINUTE,
} from "./data";

export interface Feed {
  /** The settled bars, aggregated to the current timeframe. */
  bars(): OHLC[];
  timeframe(): number;
  setTimeframe(next: number): void;
  /** The baseline for up/down — the close 24 hours ago, by trading convention. */
  referenceClose(): number;
  /**
   * Starts 400ms tick playback, handing over the bar in progress and whether
   * the minute closed. It returns a stop function, used when a comparison
   * chart comes down as the layout shrinks.
   */
  play(onTick: (current: OHLC, minuteClosed: boolean) => void): () => void;
}

/** Give it a seed and an anchor and it becomes another symbol's world, on the same minute grid. */
export function createFeed(options: { seed?: number; anchor?: number } = {}): Feed {
  const tape = buildTape(options.seed, options.anchor);
  let clock = HISTORY_MINUTES; // the minute in progress — this index of the tape is what plays
  let timeframe = 5;
  let tickIndex = 0;

  /** The settled 1-minute bars (the minute in progress isn't here yet). */
  const minutes: OHLC[] = tape.slice(0, clock);

  return {
    bars: () => aggregate(minutes, timeframe),
    timeframe: () => timeframe,
    setTimeframe(next) {
      timeframe = next;
      tickIndex = 0;
    },
    referenceClose() {
      return minutes[Math.max(0, minutes.length - 1440)].close;
    },
    play(onTick) {
      const id = setInterval(() => {
        const scripted = tape[clock];
        if (!scripted) return; // the tape ran out — three days plus six hours is enough

        const inProgress = intraTick(scripted, tickIndex, clock);
        const bucketStart = Math.floor(clock / timeframe) * timeframe;
        const bucket = [...minutes.slice(bucketStart), inProgress];
        const current = aggregate(bucket, timeframe)[0];

        tickIndex += 1;
        const minuteClosed = tickIndex >= TICKS_PER_MINUTE;
        if (minuteClosed) {
          // The minute closed — settle it at the tape's final value and move on.
          tickIndex = 0;
          minutes.push(scripted);
          clock += 1;
        }
        onTick(current, minuteClosed);
      }, 400);
      return () => clearInterval(id);
    },
  };
}
