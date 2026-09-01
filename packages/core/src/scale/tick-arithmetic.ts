/**
 * The pure arithmetic ticks are built from. It lives in `scale`, not
 * `axis`, because a scale that owns its own tick geometry (the log axis)
 * needs the same rounding the linear axis uses — and `scale` sits below
 * `axis` in the module graph, so the shared pieces have to live down here.
 * Only the pieces that speak in bare numbers moved; anything that knows
 * axis vocabulary (orientation, spacing defaults) stayed in `axis`.
 */

/**
 * The smallest value of the form 1·2·5 × 10ⁿ that is at least `raw`.
 *
 * Restricting tick intervals to these three shapes is what keeps labels
 * as human-readable numbers (10, 25, 500…).
 */
export function niceInterval(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude; // [1, 10)

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

/**
 * Adding 0.05 six times gives you 0.30000000000000004. To keep that from
 * reaching a label as-is, this keeps only the digits double precision can
 * actually distinguish.
 */
export function withoutFloatNoise(value: number): number {
  return Number.parseFloat(value.toPrecision(15));
}
