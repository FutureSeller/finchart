/**
 * Linear interpolation that stays inside the doubles. `a + t · (b − a)` is
 * the plain form, and the one used wherever it is finite — an ordinary
 * interval's result is the same bits as ever. Where the difference of the
 * ends overflows (an interval such as `[−MAX_VALUE, MAX_VALUE]`, legal for
 * a domain and for a range) — or where `t` times a finite span does, before
 * the addition would have brought the sum back inside — the same
 * interpolation is taken at half scale and doubled at the end: halving the
 * large operands that reach that path is exact, and the doubled result is
 * finite wherever the answer is.
 */
export function lerp(a: number, b: number, t: number): number {
  const grown = t * (b - a);
  if (Number.isFinite(grown)) return a + grown;
  return (a / 2 + t * (b / 2 - a / 2)) * 2;
}

/** Where `v` sits between `a` and `b`, 0 at `a` and 1 at `b` — `lerp` run backwards, with the same rule. */
export function unlerp(a: number, b: number, v: number): number {
  const span = b - a;
  const offset = v - a;
  if (Number.isFinite(span) && Number.isFinite(offset)) return offset / span;
  return (v / 2 - a / 2) / (b / 2 - a / 2);
}
