import { browserDeps } from "@finchart/dom";
import { ChartCandles, ChartContainer } from "@finchart/react";

const candles = [
  { x: 0, open: 100, high: 108, low: 98, close: 106 },
  { x: 1, open: 106, high: 112, low: 104, close: 109 },
  { x: 2, open: 109, high: 111, low: 101, close: 103 },
];

const deps = browserDeps();

export function Chart() {
  return (
    <ChartContainer deps={deps} data={candles} width={800} height={400}>
      <ChartCandles />
    </ChartContainer>
  );
}
