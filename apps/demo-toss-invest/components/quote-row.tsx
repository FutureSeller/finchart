import { sessionStart, type HistoryStatus } from "@finchart/core";
import { useState, type FormEvent } from "react";
import type { ChartSession } from "../hooks/use-chart-session";
import type { MarketDataState } from "../hooks/use-market-data";
import { marketTimeZone, intervalMs, type Interval } from "../lib/candles";

const HISTORY_LABEL: Record<HistoryStatus | "none", string> = {
  none: "No history",
  idle: "History idle",
  loading: "Loading history",
  done: "History complete",
  terminated: "History stopped (invalid data)",
  stopped: "History paused",
};

export function QuoteRow({ market, session, symbol, interval }: {
  market: MarketDataState;
  session: ChartSession;
  symbol: string;
  interval: Interval;
}) {
  const { bars, result, historyRequests, realtime, currentTrade } = market;
  const historyStatus = market.history.status ?? "none";
  const [jumpDate, setJumpDate] = useState("");
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const displayedPrice = last?.close;
  const change =
    displayedPrice !== undefined && previous
      ? ((displayedPrice - previous.close) / previous.close) * 100
      : 0;
  const currency = result?.candles[0]?.currency ?? "KRW";
  const timeZone = marketTimeZone(currency);
  /** Shows the 30 bars that start at a date — older than what's loaded, the loader has to fill the gap. */
  function jump(event: FormEvent) {
    event.preventDefault();
    const plot = session.plotRef.current;
    // A calendar date in the market's zone, as an instant: noon UTC of that
    // date falls on the same date in Seoul and New York, and the session's
    // start snaps it to that day's midnight there (a fixed offset would be an
    // hour off in New York summer time).
    const noon = Date.parse(`${jumpDate}T12:00:00Z`);
    const at = Number.isFinite(noon) ? sessionStart({ timeZone })(noon) : Number.NaN;
    if (!plot || !Number.isFinite(at)) return;
    const span = intervalMs(interval) * 30;
    market.clearHistoryRequests();
    plot.setVisibleRange(at, at + span);
  }

  return (
    <div className="quote-row">
      <div>
        <span className="symbol">{symbol}</span>
        {result && <span className={`source ${result.source}`}>{result.source === "toss" ? "LIVE API" : "DEMO DATA"}</span>}
        {result?.source === "toss" && <span className={`realtime ${realtime}`}>● {realtime}</span>}
        <span className={`history history-${historyStatus}`}>{HISTORY_LABEL[historyStatus]} · requests: {historyRequests}</span>
        {session.refused && <span className="history history-terminated" title={session.refused}>Data rejected</span>}
        <form className="jump" onSubmit={jump}>
          <input value={jumpDate} onChange={(event) => setJumpDate(event.target.value)} placeholder="YYYY-MM-DD" aria-label="Jump date" />
          <button type="submit">Jump to date</button>
        </form>
      </div>
      {displayedPrice !== undefined && (
        <div className="price">
          <strong>{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(displayedPrice)}</strong>
          <span>{currency}</span>
          <em className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</em>
          {currentTrade && (
            <small>{new Date(currentTrade.tick.timestamp).toLocaleTimeString("en-US")}</small>
          )}
        </div>
      )}
    </div>
  );
}
