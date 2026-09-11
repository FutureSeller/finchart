/**
 * Stands up the README's 60-second example for real.
 *
 * `packages/react/src/__tests__/minimal-service.types.tsx` holds the same code
 * to compiling, and this page shows that it really stands up in a browser —
 * something a unit test can't see, since jsdom has no 2D context.
 */
import type { HistogramPoint, LineDataPoint, OHLC } from "@finchart/core";
import { histogramSeries, timeTicks } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import {
  ChartCandles,
  ChartContainer,
  ChartLine,
  ChartPane,
  ChartSeries,
  Crosshair,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "@finchart/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 7, 12);

function makeBars(count: number): OHLC[] {
  const out: OHLC[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + (Math.sin(i / 7) + Math.sin(i / 3.1)) * 0.004);
    out.push({
      x: BASE + i * MINUTE,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 50 + (i % 17) * 3,
    });
    price = close;
  }
  return out;
}

const movingAverage = (bars: OHLC[], period: number): LineDataPoint[] =>
  bars.map((bar, i) => {
    if (i + 1 < period) return { x: bar.x, y: null };
    let sum = 0;
    for (let k = i + 1 - period; k <= i; k++) sum += bars[k].close;
    return { x: bar.x, y: sum / period };
  });

const volumeOf = (bar: OHLC): HistogramPoint => ({
  x: bar.x,
  y: bar.volume ?? null,
  color: bar.close >= bar.open ? "rgba(38,166,154,.5)" : "rgba(239,83,80,.5)",
});

const VOLUME_SERIES = histogramSeries();
const X_TICKS = timeTicks({ timeZone: "UTC", locale: "en-US" });
// Wiring is explicit by contract — this one line decides what enters the bundle.
const DEPS = browserDeps({ autoSize: true });

function App() {
  const [bars, setBars] = useState(() => makeBars(300));

  // Real time — change the state and you're done. No hooks, no commands.
  useEffect(() => {
    const id = setInterval(() => {
      setBars((prev) => {
        const last = prev[prev.length - 1];
        const next = { ...last, close: last.close * (1 + (Math.random() - 0.5) * 0.004) };
        return prev.slice(0, -1).concat({
          ...next,
          high: Math.max(next.high, next.close),
          low: Math.min(next.low, next.close),
        });
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <ChartContainer deps={DEPS} data={bars} style={{ height: 480 }}>
      <XAxis ticks={X_TICKS} />
      <YAxis position="right" />

      <Crosshair magnet />
      <Tooltip />
      <Legend />

      <ChartPane>
        <ChartCandles name="Price" />
        <ChartLine
          name="MA20"
          data={movingAverage(bars, 20)}
          style={{ line: { color: "#f59e0b", width: 1.5 }, point: { radius: 0 } }}
        />
      </ChartPane>

      <ChartPane flex={0.25} minHeight={48}>
        <ChartSeries series={VOLUME_SERIES} data={bars.map(volumeOf)} name="Volume" />
      </ChartPane>
    </ChartContainer>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
