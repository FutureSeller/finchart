/** The header — last price, change, and the hovered bar's OHLC. It reflects the focused chart's snapshot. */
import type { OHLC } from "@finchart/core";
import { wonDetail, wonExact } from "./format";

export function SymbolHeader({
  symbol,
  last,
  shown,
  refClose,
}: {
  /** The focused chart's symbol. */
  symbol: string;
  /** The live last bar — the price and change always come from this. */
  last: OHLC | null;
  /** The hovered bar, or the last bar when the cursor leaves — the OHLC line comes from this. */
  shown: OHLC | null;
  /** The baseline for the change — the close 24 hours ago, by trading convention. */
  refClose: number;
}) {
  const diff = last ? last.close - refClose : 0;
  const pct = last ? (diff / refClose) * 100 : 0;
  const cls = diff >= 0 ? "up" : "down";
  const barCls = shown && shown.close >= shown.open ? "up" : "down";

  return (
    <div id="symbol-block">
      <span id="symbol">{symbol}</span>
      <span id="price" className={cls}>
        {last ? wonExact.format(Math.round(last.close)) : "—"}
      </span>
      <span id="change" className={cls}>
        {last
          ? `${diff >= 0 ? "+" : ""}${wonDetail(diff)} (${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%)`
          : "—"}
      </span>
      <span id="ohlc">
        {shown ? (
          <>
            O <b className={barCls}>{wonDetail(shown.open)}</b> H{" "}
            <b className={barCls}>{wonDetail(shown.high)}</b> L{" "}
            <b className={barCls}>{wonDetail(shown.low)}</b> C{" "}
            <b className={barCls}>{wonDetail(shown.close)}</b>
          </>
        ) : null}
      </span>
    </div>
  );
}
