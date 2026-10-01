/**
 * The last-resort fallback for formatting. The axis owns formatting (x via
 * `config.axis.x.format`, y via `PaneOptions.axis.format ?? config.axis.y.format`);
 * this constant only applies when the axis says nothing. The badge
 * surfaces — crosshair, tooltip, legend, priceLine — read the same
 * constant so *they* can't drift from each other. With no format set the
 * tick labels print the value as-is, and the badges keep two decimals
 * unless the ruler is finer than a cent — then they take the ruler's
 * digits, so a sub-cent price never reads `0.00` next to ticks that show it.
 */
export type ValueFormat = (value: number) => string;

/** Default x formatting — the common minimum for bar index and continuous x (rounded to an integer). */
export const DEFAULT_X_FORMAT: ValueFormat = (value) =>
  String(Math.round(value));

/**
 * Default y formatting — two decimal places, more when the tick interval
 * (`step`) needs them to tell neighbors apart.
 */
export const DEFAULT_Y_FORMAT = (value: number, step?: number): string =>
  value.toFixed(step && step > 0 ? Math.min(100, Math.max(2, decimalsOf(step))) : 2);

/** Count decimal places without discarding valid ticks below 1e-8. */
export function decimalsOf(move: number): number {
  // Fifteen significant digits remove arithmetic noise, not leading zeros.
  const [coefficient, exponent = "0"] = Number(move.toPrecision(15)).toString().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}
