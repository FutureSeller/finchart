import type { OHLC } from "@finchart/core";
import { priceFormat } from "@finchart/core";
import { atrPriceStep, renko } from "@finchart/indicators";
import { browserDeps } from "@finchart/dom";
import { ChartCandles, ChartContainer, Crosshair, XAxis, YAxis } from "@finchart/react";
import { useCallback, useMemo } from "react";
import { marketTimeZone, type Interval } from "../lib/candles";
import { fixedBrick, type BrickMode } from "../lib/chart-view";

const DEPS = browserDeps({ autoSize: true });

/** Renko uses ordinal x values; its axis labels read each brick's closing time. */
export function RenkoChart({ bars, mode, currency, interval }: {
  bars: OHLC[];
  mode: BrickMode;
  currency: string;
  interval: Interval;
}) {
  const timeZone = marketTimeZone(currency);
  const formatPrice = useMemo(() => priceFormat({ precision: currency === "USD" ? 2 : 0, locale: "en-US" }), [currency]);
  const fixed = fixedBrick(currency);
  const brickSize = mode === "fixed" ? fixed : bars.length >= 14 ? atrPriceStep(bars, { period: 14 }) : fixed;
  const bricks = useMemo(() => renko(bars, { brickSize }), [bars, brickSize]);
  // Minute bars close within a day — the time is what tells bricks apart.
  const label = useMemo(
    () => new Intl.DateTimeFormat("en-US", interval === "1m"
      ? { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { timeZone, month: "numeric", day: "numeric" }),
    [timeZone, interval],
  );
  const format = useCallback(
    (x: number) => {
      const brick = bricks[Math.round(x)];
      return brick ? label.format(brick.closedAt) : "";
    },
    [bricks, label],
  );
  return (
    <>
      <div className="renko-note">Bricks: {bricks.length.toLocaleString("en-US")} · size: {brickSize.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
      <ChartContainer deps={DEPS} data={bricks} style={{ height: 480 }}>
        <XAxis format={format} />
        <YAxis position="right" format={formatPrice} />
        <Crosshair magnet />
        <ChartCandles name="Renko" />
      </ChartContainer>
    </>
  );
}
