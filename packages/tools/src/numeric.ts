/** A translated, scaled difference without overflowing the intermediate span. */
export function translatedDifference(base: number, to: number, from: number, factor: number): number {
  if (factor === 0 || to === from) return base;
  if (factor === 1 && base === from) return to;
  if (factor === -1 && base === to) return from;
  const delta = (to - from) * factor;
  const result = base + delta;
  if (Number.isFinite(delta) && Number.isFinite(result)) return result;
  const scale = Math.max(Math.abs(base), Math.abs(to), Math.abs(from));
  return (base / scale + (to / scale - from / scale) * factor) * scale;
}

/** Midpoints need not form the potentially unrepresentable sum first. */
export function midpoint(a: number, b: number): number {
  const sum = a + b;
  return Number.isFinite(sum) ? sum / 2 : a / 2 + b / 2;
}
