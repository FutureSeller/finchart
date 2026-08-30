import { candleSeries } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";

const plot = PlotBuilder.create(browserDeps(), candleSeries())
  .addDataPoints([
    { x: 0, open: 100, high: 108, low: 98, close: 106 },
    { x: 1, open: 106, high: 112, low: 104, close: 109 },
    { x: 2, open: 109, high: 111, low: 101, close: 103 },
  ])
  .setSize(800, 400)
  .build(document.getElementById("chart")!);

export { plot };
