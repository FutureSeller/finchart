"use client";

import { useState } from "react";
import { useMarketData } from "../hooks/use-market-data";
import { useChartSession } from "../hooks/use-chart-session";
import { DashboardToolbar } from "../components/dashboard-toolbar";
import { QuoteRow } from "../components/quote-row";
import { MarketChart } from "../components/market-chart";
import type { Interval } from "../lib/candles";
import type { ChartView } from "../lib/chart-view";

export function MarketDashboard() {
  const [symbol, setSymbol] = useState("005930");
  const [interval, setInterval] = useState<Interval>("1d");
  const [view, setView] = useState<ChartView>({
    kind: "candle", indicators: new Set(), periods: { ma: 20, rsi: 14 }, log: false, renkoMode: null,
  });
  const market = useMarketData(symbol, interval);
  const mountedSymbol = market.result?.symbol ?? symbol;
  const liveInterval = market.result?.interval ?? interval;
  const session = useChartSession(mountedSymbol, liveInterval);
  const currency = market.result?.candles[0]?.currency ?? "KRW";

  function selectSymbol(next: string) {
    session.resetForSymbol(next);
    setSymbol(next);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">F</span> finchart · Toss demo</div>
        <a href="https://developers.tossinvest.com/docs" target="_blank" rel="noreferrer">Toss Open API documentation ↗</a>
      </header>
      <section className="hero">
        <p className="eyebrow">NEXT.JS · TOSS SECURITIES OPEN API</p>
        <h1>Market data,<br />interactive charts.</h1>
        <p className="lede">Explore synthetic candles or connect Toss market data through the server.</p>
      </section>
      <section className="terminal">
        <DashboardToolbar
          symbol={symbol} interval={interval} setInterval={setInterval}
          view={view} setView={setView} session={session} currency={currency} onSymbolChange={selectSymbol}
        />
        <QuoteRow market={market} session={session} symbol={symbol} interval={liveInterval} />
        <MarketChart market={market} session={session} view={view} symbol={mountedSymbol} interval={liveInterval} />
      </section>
      <footer>
        <span>Market data only</span><span>Synthetic data by default</span><span>Drawings stay in this page</span>
      </footer>
    </main>
  );
}
