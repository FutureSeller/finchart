import type { Interval } from "../lib/candles";
import type { ChartView } from "../lib/chart-view";
import type { MarketDataState } from "../hooks/use-market-data";
import type { ChartSession } from "../hooks/use-chart-session";
import { RenkoChart } from "./renko-chart";
import { TimeChart } from "./time-chart";

/** Chooses the chart representation and presents loading/error state. */
export function MarketChart({ market, session, view, symbol, interval }: {
  market: MarketDataState;
  session: ChartSession;
  view: ChartView;
  symbol: string;
  interval: Interval;
}) {
  const { bars, result, error, loading } = market;
  const currency = result?.candles[0]?.currency ?? "KRW";
  return (
    <div className="chart-shell" aria-busy={loading}>
      {error ? <div className="state error">{error}</div> : view.renkoMode && bars.length > 0 ? (
        <RenkoChart bars={bars} mode={view.renkoMode} currency={currency} interval={interval} />
      ) : bars.length > 0 ? (
        <TimeChart key={`${symbol}-${interval}`} market={market} session={session} view={view} symbol={symbol} interval={interval} />
      ) : <div className="state">Loading candles.</div>}
      {loading && bars.length > 0 && <div className="loading">Updating…</div>}
    </div>
  );
}
