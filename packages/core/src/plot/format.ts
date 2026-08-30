/**
 * The last-resort fallback for formatting. The axis owns formatting (x via
 * `config.axis.x.format`, y via `PaneOptions.axis.format ?? config.axis.y.format`);
 * this constant only applies when the axis says nothing. Five surfaces —
 * axis, crosshair, tooltip, legend, priceLine — read the same constant so
 * their formatting never drifts apart.
 */
export type ValueFormat = (value: number) => string;

/** Default x formatting — the common minimum for bar index and continuous x (rounded to an integer). */
export const DEFAULT_X_FORMAT: ValueFormat = (value) =>
  String(Math.round(value));

/** Default y formatting — two decimal places. */
export const DEFAULT_Y_FORMAT: ValueFormat = (value) => value.toFixed(2);
