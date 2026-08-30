/**
 * Fake BTC/KRW quotes — **deterministic, and plausible.**
 *
 * Half of whether a demo convinces is the data: a `Math.sin` wave makes a
 * chart look like a toy. This imitates volatility clustering instead — quiet
 * stretches and violent ones arrive in clumps (a GARCH impression). The same
 * seed gives the same picture whenever you open it, which also makes
 * screenshots comparable across regressions.
 */
import type { OHLC } from "@finchart/core";

export const SYMBOL = "BTC/KRW";
export const MINUTE = 60_000;
export const BASE_TIME = Date.UTC(2026, 7, 12, 0, 0); // 2026-08-12 00:00 UTC
export const HISTORY_MINUTES = 60 * 24 * 3; // three days of 1-minute bars

/** mulberry32 — a small, sufficient seeded RNG (the same lineage as the examples fixture). */
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

/** Roughly normal — summing three draws is bell-shaped enough. */
function gauss(rand: () => number): number {
  return rand() + rand() + rand() - 1.5;
}

interface MinuteBar extends OHLC {
  volume: number;
}

/**
 * Builds every 1-minute bar up front — the live ticks replay the tail of this
 * same tape. Only a rewindable world makes "the same chart after a reload"
 * true.
 */
export function buildTape(seed = 20260812, anchor = 104_000_000): MinuteBar[] {
  const rand = mulberry32(seed);
  const bars: MinuteBar[] = [];

  let price = anchor;
  let vol = 0.0008; // per-minute volatility (a ratio) — the cluster's state

  for (let i = 0; i < HISTORY_MINUTES + FUTURE_MINUTES; i++) {
    // Volatility attracts itself: quiet stays quiet, and a shock stays loud
    // for a while. The occasional jump is what triggers a cluster.
    const shock = rand() < 0.008 ? rand() * 0.002 : 0;
    vol = Math.min(0.0028, Math.max(0.0003, vol * (0.985 + rand() * 0.03) + shock));

    const open = price;
    // A weak mean reversion — over several days it stays in a range near the
    // anchor, which stops the random walk from draining off in one direction.
    const pull = ((anchor - price) / price) * 0.0015;
    const drift = gauss(rand) * vol + pull;
    const close = open * (1 + drift);
    const range = Math.abs(drift) + vol * (0.4 + rand());
    const high = Math.max(open, close) * (1 + range * rand() * 0.6);
    const low = Math.min(open, close) * (1 - range * rand() * 0.6);

    // Volume moves with |return| — a violent bar is a thick one.
    const volume = Math.round(8 + Math.abs(drift) * 220_000 + vol * 90_000 * rand());

    bars.push({ x: BASE_TIME + i * MINUTE, open, high, low, close, volume });
    price = close;
  }

  return bars;
}

/** How much future tape the live feed has to replay. */
export const FUTURE_MINUTES = 60 * 6;

/** 1-minute bars → n-minute bars. The material for switching timeframe. */
export function aggregate(minutes: readonly OHLC[], n: number): OHLC[] {
  if (n === 1) return [...minutes];

  const out: OHLC[] = [];
  for (let i = 0; i < minutes.length; i += n) {
    const bucket = minutes.slice(i, i + n);
    out.push({
      x: bucket[0].x,
      open: bucket[0].open,
      close: bucket[bucket.length - 1].close,
      high: Math.max(...bucket.map((bar) => bar.high)),
      low: Math.min(...bucket.map((bar) => bar.low)),
      volume: bucket.reduce((sum, bar) => sum + (bar.volume ?? 0), 0),
    });
  }
  return out;
}

/**
 * The bar in progress — one minute split into `TICKS_PER_MINUTE` intermediate
 * fills. The last bar has to actually squirm for it to read as "in progress".
 */
export const TICKS_PER_MINUTE = 5;

export function intraTick(
  bar: MinuteBar,
  tickIndex: number,
  seed: number,
): OHLC {
  const rand = mulberry32(seed * 7919 + tickIndex);
  const progress = (tickIndex + 1) / TICKS_PER_MINUTE;

  // Moves toward the close in proportion to progress, and the last tick lands exactly on the tape's close.
  const close =
    progress >= 1
      ? bar.close
      : bar.open + (bar.close - bar.open) * progress * (0.6 + rand() * 0.8);
  const high = Math.max(bar.open, close, bar.open + (bar.high - bar.open) * progress);
  const low = Math.min(bar.open, close, bar.open + (bar.low - bar.open) * progress);

  return {
    x: bar.x,
    open: bar.open,
    high,
    low,
    close,
    volume: Math.round((bar.volume ?? 0) * progress),
  };
}
