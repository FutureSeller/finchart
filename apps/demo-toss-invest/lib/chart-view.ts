export type ChartKind = "candle" | "line" | "area";
export type IndicatorKey = "MA20" | "BOLL" | "RSI" | "MACD";
export type BrickMode = "fixed" | "atr";
export const INDICATOR_KEYS: readonly IndicatorKey[] = ["MA20", "BOLL", "RSI", "MACD"];

export interface ChartView {
  kind: ChartKind;
  indicators: ReadonlySet<IndicatorKey>;
  periods: { ma: number; rsi: number };
  log: boolean;
  renkoMode: BrickMode | null;
}

/** A fixed brick in the quote currency's own units. */
export function fixedBrick(currency: string): number {
  return currency === "USD" ? 1 : 1000;
}
