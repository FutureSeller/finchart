/**
 * The pure arithmetic ticks are built from. It lives in `scale`, not
 * `axis`, because a scale that owns its own tick geometry (the log axis)
 * needs the same rounding the linear axis uses — and `scale` sits below
 * `axis` in the module graph, so the shared pieces have to live down here.
 * Only the pieces that speak in bare numbers moved; anything that knows
 * axis vocabulary (orientation, spacing defaults) stayed in `axis`.
 */

/**
 * The smallest value of the form 1·2·5 × 10ⁿ that is at least `raw` —
 * except at the two ends of the doubles, where that value does not exist:
 * at the top the decade itself (the next shape up is past the doubles),
 * at the bottom the smallest double (the decade under it is 0). Both are
 * positive and finite, which is what a step must be.
 *
 * Restricting tick intervals to these three shapes is what keeps labels
 * as human-readable numbers (10, 25, 500…).
 */
export function niceInterval(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;

  // At the bottom of the doubles the decade under the smallest subnormal is 0 — the smallest double is the
  // decade there.
  const magnitude = 10 ** Math.floor(Math.log10(raw)) || Number.MIN_VALUE;
  const normalized = raw / magnitude; // [1, 10)

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return Number.isFinite(2 * magnitude) ? 2 * magnitude : magnitude;
  if (normalized <= 5) return Number.isFinite(5 * magnitude) ? 5 * magnitude : magnitude;
  // At the top of the doubles the next nice step up is past them — the decade itself is the nice step there.
  const nice = 10 * magnitude;
  return Number.isFinite(nice) ? nice : magnitude;
}

/**
 * Adding 0.05 six times gives you 0.30000000000000004. To keep that from
 * reaching a label as-is, this keeps only the digits double precision can
 * actually distinguish.
 */
export function withoutFloatNoise(value: number): number {
  const rounded = Number.parseFloat(value.toPrecision(15));
  // Fifteen digits of the largest doubles round past them — a tick at the edge of the range stays as it is.
  return Number.isFinite(rounded) ? rounded : value;
}
