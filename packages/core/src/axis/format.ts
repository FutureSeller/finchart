/**
 * The last-resort fallback for formatting. The axis owns formatting (x via
 * `config.axis.x.format`, y via `PaneOptions.axis.format ?? config.axis.y.format`);
 * this constant only applies when the axis says nothing. The badge
 * surfaces — crosshair, tooltip, legend, priceLine — read the same
 * constant so *they* can't drift from each other. Tick labels are the
 * exception: with no format set they print the value as-is, so an
 * unformatted chart shows `1234.5` on the axis next to `1234.50` on a
 * badge — a split kept on purpose, because unifying the default would
 * change every chart that never touched formatting.
 */
export type ValueFormat = (value: number) => string;

/** Default x formatting — the common minimum for bar index and continuous x (rounded to an integer). */
export const DEFAULT_X_FORMAT: ValueFormat = (value) =>
  String(Math.round(value));

/** Default y formatting — two decimal places. */
export const DEFAULT_Y_FORMAT: ValueFormat = (value) => value.toFixed(2);
