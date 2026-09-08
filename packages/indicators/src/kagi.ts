import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describeValue, requireOptions, requireSourceArray } from "./kernels";

/**
 * Kagi — a price-axis transform in the Renko lineage: time is thrown away
 * and a single line follows the close, turning only when the close backs
 * off its extreme by `reversal`. A point's x is an ordinal (0, 1, 2…), one
 * per vertex; the last point is the line's live end and moves with the
 * close until a reversal fixes it. `tone` is the yang/yin of the segment
 * that ends at the point (`up` = yang, drawn thick; `down` = yin, thin) and
 * `breakY`, when present, is the price inside that segment where the tone
 * changed — a rising segment turns yang the moment it rises above the
 * previous shoulder, a falling one turns yin the moment it falls below the
 * previous waist (the shoulder or waist already standing when the segment
 * began — Nison's rules 10 and 11); a segment is monotone, so that happens
 * at most once.
 * Register it as a derivation — see the guide's "Price-axis transforms".
 */
export interface KagiPoint {
  /** The point's ordinal — this is the chart's x. */
  x: number;
  /** The price at the vertex (or, for the last point, the line's current end). */
  y: number;
  /** The x of the source candle whose close set `y`. The key the axis format uses to recover time. */
  closedAt: number;
  /**
   * The tone of the segment ending here — `up` is yang (thick), `down` is yin
   * (thin). Tone is not direction: a falling segment that has not yet dropped
   * below the previous waist stays yang, a rising one short of the previous
   * shoulder stays yin. The first point carries the first segment's tone,
   * which is that segment's direction.
   */
  tone: "up" | "down";
  /** The price inside the segment ending here at which the tone changed — the shoulder or waist it crossed. Absent when it did not. */
  breakY?: number;
}

export interface KagiOptions {
  /** The pullback from the line's extreme that turns it — an absolute price distance, a positive finite number, required. */
  reversal: number;
}

/**
 * Close-based, one candle moves the line once. The first candle's close is
 * the start; the first close at least `reversal` away from it sets the
 * direction (Nison's rules 1–3 — nothing is drawn while the first move is
 * short of the reversal amount). In
 * the running direction a close beyond the line's extreme extends it (the
 * last point's `y` and `closedAt` move). A close that backs off the extreme
 * by `reversal` or more fixes the extreme as a vertex and starts the
 * opposite segment from it, ending at that close. Anything else moves
 * nothing. The shoulders (a fixed vertex ending a rising segment) and
 * waists (ending a falling one) are what the next segments cross for their
 * tone.
 */
export function kagi(source: readonly OHLC[], options: KagiOptions): KagiPoint[] {
  requireSourceArray(source, "kagi");
  requireOptions(options, "kagi");
  const { reversal } = options;
  if (typeof reversal !== "number" || !(reversal > 0) || !Number.isFinite(reversal)) {
    throw new ContractError(`kagi reversal must be a positive finite number, got ${describeValue(reversal)}`);
  }

  const points: KagiPoint[] = [];
  if (source.length === 0) return points;

  const first = source[0];
  let direction: 1 | -1 | 0 = 0;
  let tone: "up" | "down" = "up";
  let shoulder: number | null = null; // the previous rising segment's fixed peak
  let waist: number | null = null; // the previous falling segment's fixed trough
  let crossAt: number | null = null; // the level the running segment must cross to change tone
  let head: KagiPoint = { x: 0, y: first.close, closedAt: first.x, tone };
  points.push(head);

  const startSegment = (from: KagiPoint, next: 1 | -1, close: number, closedAt: number): void => {
    // The vertex the segment leaves becomes a shoulder or a waist for the segments after it.
    if (direction === 1) shoulder = from.y;
    else if (direction === -1) waist = from.y;
    direction = next;
    crossAt = next === 1 ? shoulder : waist;
    head = { x: points.length, y: close, closedAt, tone };
    points.push(head);
    crossIfDue();
  };

  /** A rising segment above the previous shoulder is yang; a falling one below the previous waist is yin. */
  function crossIfDue(): void {
    if (crossAt === null) return;
    const crossed = direction === 1 ? head.y > crossAt && tone !== "up" : head.y < crossAt && tone !== "down";
    if (!crossed) return;
    tone = direction === 1 ? "up" : "down";
    head.tone = tone;
    head.breakY = crossAt;
  }

  for (let i = 1; i < source.length; i++) {
    const candle = source[i];
    const close = candle.close;
    if (direction === 0) {
      if (Math.abs(close - head.y) < reversal) continue;
      // The first move of at least the reversal amount: its direction is the first segment's tone, the start
      // point carries it, and the line's live end becomes a second point.
      tone = close > head.y ? "up" : "down";
      points[0].tone = tone;
      direction = close > head.y ? 1 : -1;
      head = { x: points.length, y: close, closedAt: candle.x, tone };
      points.push(head);
      continue;
    }
    if (direction === 1 ? close > head.y : close < head.y) {
      head.y = close;
      head.closedAt = candle.x;
      crossIfDue();
      continue;
    }
    if (direction === 1 ? head.y - close >= reversal : close - head.y >= reversal) {
      startSegment(head, direction === 1 ? -1 : 1, close, candle.x);
    }
  }

  return points;
}
