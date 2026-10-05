import { useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import type { ChartSession } from "../hooks/use-chart-session";
import type { Interval } from "../lib/candles";
import { INDICATOR_KEYS, fixedBrick, type ChartView } from "../lib/chart-view";
import { PeriodInput } from "./period-input";

export function DashboardToolbar({ symbol, interval, setInterval, view, setView, session, currency, onSymbolChange }: {
  symbol: string;
  interval: Interval;
  setInterval: (interval: Interval) => void;
  view: ChartView;
  setView: Dispatch<SetStateAction<ChartView>>;
  session: ChartSession;
  currency: string;
  onSymbolChange: (symbol: string) => void;
}) {
  const [symbolInput, setSymbolInput] = useState(symbol);
  const { kind: chartKind, indicators, periods, log, renkoMode } = view;
  const { priceTools, rsiTools, drawMode, draw } = session;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = symbolInput.trim().toUpperCase();
    if (next && next !== symbol) onSymbolChange(next);
  }
  return (
    <div className="terminal-head">
      <form onSubmit={submit}>
        <label>
          <span>Symbol</span>
          <input value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} aria-label="Symbol" />
        </label>
        <button type="submit">Load</button>
      </form>
      <div className="controls">
        <div className="intervals" aria-label="Candle interval">
          {(["1d", "1m"] as const).map((value) => (
            <button key={value} className={interval === value ? "active" : ""} onClick={() => {
              if (value !== interval) session.clearTimeWindow();
              setInterval(value);
            }}>
              {value === "1d" ? "Daily" : "1 minute"}
            </button>
          ))}
        </div>
        <div className="intervals" aria-label="Chart type">
          {(["candle", "line", "area"] as const).map((value) => (
            <button key={value} className={chartKind === value ? "active" : ""} onClick={() => setView((current) => ({ ...current, kind: value }))}>
              {value === "candle" ? "Candles" : value === "line" ? "Line" : "Area"}
            </button>
          ))}
        </div>
        <div className="intervals" role="group" aria-label="Drawing tools">
          <button onClick={() => draw(priceTools, "trend")}>Trend line</button>
          <button onClick={() => draw(priceTools, "fib")}>Fibonacci</button>
          <button disabled={!rsiTools} onClick={() => draw(rsiTools, "trend")}>RSI trend line</button>
          <span className="draw-mode">{drawMode}</span>
        </div>
        <div className="intervals" role="group" aria-label="Renko">
          {(["fixed", "atr"] as const).map((mode) => (
            <button key={mode} className={renkoMode === mode ? "active" : ""} aria-pressed={renkoMode === mode} onClick={() => {
              if (!renkoMode) {
                session.saveTimeWindow();
              }
              setView((current) => ({ ...current, renkoMode: current.renkoMode === mode ? null : mode }));
            }}>
              {mode === "fixed" ? `Renko ${fixedBrick(currency).toLocaleString("en-US")}` : "Renko ATR"}
            </button>
          ))}
        </div>
        <PeriodInput label="MA" value={periods.ma} onCommit={(ma) => setView((current) => ({ ...current, periods: { ...current.periods, ma } }))} />
        <PeriodInput label="RSI" value={periods.rsi} onCommit={(rsi) => setView((current) => ({ ...current, periods: { ...current.periods, rsi } }))} />
        <div className="intervals" role="group" aria-label="View">
          <button className={log ? "active" : ""} aria-pressed={log} onClick={() => setView((current) => ({ ...current, log: !current.log }))}>Log</button>
        </div>
        <div className="intervals" role="group" aria-label="Indicators">
          {INDICATOR_KEYS.map((key) => (
            <button
              key={key}
              className={indicators.has(key) ? "active" : ""}
              aria-pressed={indicators.has(key)}
              onClick={() =>
                setView((current) => {
                  const next = new Set(current.indicators);
                  if (!next.delete(key)) next.add(key);
                  return { ...current, indicators: next };
                })
              }
            >
              {key === "MA20" ? `MA${periods.ma}` : key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
