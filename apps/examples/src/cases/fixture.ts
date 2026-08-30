/**
 * The shared quotes for the cases — deterministic. The same seed gives the
 * same picture whenever and wherever you open it, which makes a gallery
 * screenshot material for a regression comparison.
 *
 * It's shared material, not a contract — a case that needs different data
 * makes its own.
 */
import type { OHLC } from "@finchart/core";

const MINUTE = 60_000;
export const FIXTURE_BASE = Date.UTC(2026, 7, 10, 9, 0); // 2026-08-10 09:00 UTC

/** mulberry32 — a small, sufficient seeded RNG. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` one-minute bars — a random walk with a trend mixed in, volume included. */
export function fixtureCandles(count = 300, seed = 7): OHLC[] {
  const rand = mulberry32(seed);
  let close = 50_000;

  return Array.from({ length: count }, (_, index) => {
    const open = close;
    const move = (rand() - 0.5) * 800 + Math.sin(index / 23) * 220;
    close = Math.max(1_000, open + move);
    const spread = rand() * 260 + 40;

    return {
      x: FIXTURE_BASE + index * MINUTE,
      open,
      close,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      volume: Math.round(100 + rand() * 400),
    };
  });
}
