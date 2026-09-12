import type { SeriesSample } from "@finchart/core";

/** The format for a described row — its value with the row's label and the sample it belongs to. A `null` value reads as a dash and never reaches it. */
export type RowFormat = (value: number, row: { label: string; sample: SeriesSample }) => string;

/**
 * One sample's text: the series' own rows when it describes itself
 * (`SOXL: O 105.75 H 106.10 L 104.90 C 105.30 V 800`), else the one value
 * behind its name. Shared by the tooltip and the legend — they differ in
 * the separator after the name (`: ` and a space), on both shapes alike.
 */
export function sampleText(
  sample: SeriesSample,
  formatValue: (value: number) => string,
  formatRow: RowFormat,
  separator: string,
): string {
  // `[]` says nothing, like `undefined` — the one value behind the name is shown instead.
  if (sample.rows !== undefined && sample.rows.length > 0) {
    const parts = sample.rows
      .map((row) => `${row.label} ${row.value === null ? "—" : formatRow(row.value, { label: row.label, sample })}`)
      .join(" ");
    return sample.name ? `${sample.name}${separator}${parts}` : parts;
  }
  const value = sample.value === null ? "—" : formatValue(sample.value);
  return sample.name ? `${sample.name}${separator}${value}` : value;
}
