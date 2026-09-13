import type { Plot } from "@finchart/core";
import { drawingTools } from "@finchart/tools";

declare const plot: Plot;

/** What a set of drawings belongs to — the same symbol and interval the data was fetched for. */
interface ChartIdentity {
  symbol: string;
  interval: string;
}

const tools = plot.mainPane.use(drawingTools({ plot }));

// One key per identity. A single key would put BTC's trend line on AAPL.
const keyOf = ({ symbol, interval }: ChartIdentity) => `drawings:${symbol}:${interval}`;

let current: ChartIdentity = { symbol: "BTC-USD", interval: "1m" };

// Restore the identity you start on before anything is saved — the first
// save below would otherwise write an empty stage over what was there.
if (!tools.load(localStorage.getItem(keyOf(current)) ?? "")) tools.clear();

export function switchTo(next: ChartIdentity): void {
  // 1. Save what is on the stage under the identity it belongs to.
  localStorage.setItem(keyOf(current), tools.serialize());
  // 2. Switch, then load — and clear when there is nothing (or nothing
  //    readable) to load: a failed load keeps the stage exactly as it was,
  //    which here would be the previous symbol's drawings.
  current = next;
  if (!tools.load(localStorage.getItem(keyOf(next)) ?? "")) tools.clear();
}
