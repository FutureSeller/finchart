/** Formatting — one set of won and time formatters. */
import { priceFormat } from "@finchart/core";

export const won = priceFormat({ compact: true, locale: "en-US" });

/**
 * Precision where a human reads it — `priceFormat` takes a tick spacing as its
 * second argument and widens the significant digits accordingly. The axis
 * passes its own; the header, legend and tooltip are ours to pass.
 */
export const wonDetail = (value: number) => won(value, 10_000);

export const wonExact = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export const timeLabel = (x: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(x);
