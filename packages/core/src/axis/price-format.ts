import {
  ContractError,
  describe,
  requireNonNegative,
  requireObject,
  requirePositive,
} from "../primitives";

/**
 * A price-format helper — a pure function that plugs into an axis
 * `format`, a crosshair, and a tooltip alike. The vocabulary follows
 * lightweight-charts: `precision` (decimal places), `minMove` (the tick
 * size — an instrument quoted in 0.05 increments only ever speaks in
 * multiples of 0.05), `compact` (1.2M — where a volume axis belongs).
 *
 * Given a tick interval as the second argument, it chooses the number of
 * digits that keep neighboring ticks from rendering as the same string
 * (preventing "1.1M·1.1M·1M·1M"). If `precision` or `minMove` is given
 * explicitly, the interval is ignored — precision belongs to the caller.
 */
export interface PriceFormatOptions {
  /** Decimal places. Derived from `minMove` if omitted, otherwise 2. */
  precision?: number;
  /** The tick size — snaps the value to a multiple of this before formatting. */
  minMove?: number;
  /** 1.2M · 3.4K — shortens large numbers. Where a volume axis belongs. */
  compact?: boolean;
  locale?: string;
}

export function priceFormat(
  options: PriceFormatOptions = {},
): (value: number, step?: number) => string {
  /**
   * The need for this validation came from what exchanges actually hand
   * you — Binance's `exchangeInfo` gives `PRICE_FILTER.tickSize` as the
   * string `"0.01000000"`, and something like `minMove:
   * Number(meta?.tickSize)` can produce `NaN` when metadata is missing.
   * Letting `NaN` pass silently drops the whole axis back to the default
   * digit count, reviving the very symptom this function exists to
   * prevent — "1.1M·1.1M·1M·1M".
   *
   * `locale` isn't validated here — the set of valid BCP 47 tags isn't
   * ours to define. Instead, whatever `Intl` throws gets translated into a
   * contract error, so what the consumer sees carries this gate's name.
   */
  requireObject(options, "priceFormat(options)");
  const { precision, minMove, compact, locale } = options;
  if (precision !== undefined) {
    requireNonNegative(precision, "priceFormat({ precision })");
    if (!Number.isInteger(precision) || precision > 100) {
      throw new ContractError(
        `priceFormat({ precision }) must be an integer in 0..100, got ${describe(precision)}`,
      );
    }
  }
  if (minMove !== undefined) {
    requirePositive(minMove, "priceFormat({ minMove })");
  }
  const decimals = precision ?? (minMove ? decimalsOf(minMove) : 2);
  const stepAware = precision === undefined && minMove === undefined;

  const numberFormat = (
    options_: Intl.NumberFormatOptions,
  ): Intl.NumberFormat => {
    try {
      return new Intl.NumberFormat(locale, options_);
    } catch (error) {
      throw new ContractError(
        `priceFormat({ locale }) was rejected by Intl — must be a BCP 47 tag (e.g. "en-US"), ` +
          `got ${describe(locale)} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  };

  const base = numberFormat(
    compact
      ? { notation: "compact", maximumFractionDigits: Math.min(decimals, 1) }
      : decimals > 100
        ? { notation: "scientific", maximumSignificantDigits: 17 }
        : {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        },
  );

  // Cache of instances by digit count — the interval is constant within a single axis, so this always hits.
  const variants = new Map<number, Intl.NumberFormat>();
  const compactWith = (digits: number): Intl.NumberFormat => {
    let format = variants.get(digits);
    if (!format) {
      format = numberFormat({
        notation: "compact",
        maximumSignificantDigits: digits,
      });
      variants.set(digits, format);
    }
    return format;
  };
  const plainWith = (digits: number): Intl.NumberFormat => {
    let format = variants.get(digits);
    if (!format) {
      format = numberFormat(digits > 100
        ? { notation: "scientific", maximumSignificantDigits: 17 }
        : { minimumFractionDigits: digits, maximumFractionDigits: digits });
      variants.set(digits, format);
    }
    return format;
  };

  return (value, step) => {
    const snapped =
      minMove !== undefined && minMove > 0
        ? snapToMove(value, minMove)
        : value;

    if (stepAware && step !== undefined && step > 0) {
      if (compact) {
        // With d = ⌈log₁₀(|value|/step)⌉+1 digits, resolution ≤ step — neighbors
        // are guaranteed to render as different strings. Intl drops trailing zeros ("1M").
        const ratio = Math.abs(snapped) / step;
        const digits = Math.min(
          21,
          Math.max(2, Math.ceil(Math.log10(Math.max(ratio, 1))) + 1),
        );
        return compactWith(digits).format(snapped);
      }

      // The default of 2 decimals only ever grows — a coarser interval leaves it unchanged.
      const needed = decimalsOf(step);
      if (needed > decimals) return plainWith(needed).format(snapped);
    }

    return base.format(snapped);
  };
}

/** Count decimal places without discarding valid ticks below 1e-8. */
function decimalsOf(move: number): number {
  // Fifteen significant digits remove arithmetic noise, not leading zeros.
  const [coefficient, exponent = "0"] = Number(move.toPrecision(15)).toString().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}

function snapToMove(value: number, move: number): number {
  const units = value / move;
  // At this magnitude a step is below the value's representable resolution.
  if (!Number.isFinite(units)) return value;
  const snapped = Math.round(units) * move;
  // A finite price must never be displayed as infinity through rounding.
  return Number.isFinite(value) && !Number.isFinite(snapped) ? value : snapped;
}
