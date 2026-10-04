import { candleSeries, infiniteHistory, type OHLC } from "@finchart/core";
import { browserDeps, PlotBuilder } from "@finchart/dom";
import { renko } from "@finchart/indicators";

export function mountRenkoHistory(
  element: HTMLElement,
  initial: OHLC[],
  brickSize: number,
  fetchBefore: (before: number) => Promise<OHLC[]>,
) {
  if (initial.length === 0) throw new Error("an initial page is required");
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(900, 480)
    .build(element);
  const handle = plot.mainPane.addSeries({
    series: candleSeries(),
    data: initial,
    derive: (candles: readonly OHLC[]) => renko(candles, { brickSize }),
  });
  let firstSourceX = initial[0].x;
  const loader = infiniteHistory(
    plot,
    (page: OHLC[]) => {
      handle.prepend(page);
      firstSourceX = page[0].x;
      // Prepending can renumber every brick. Choose an explicit new anchor.
      plot.fitDomains();
    },
    fetchBefore,
    {
      from: firstSourceX,
      viewFrontier: () => {
        const firstBrick = handle.read()[0];
        return firstBrick ? { sourceX: firstSourceX, plottedX: firstBrick.x } : null;
      },
    },
  );
  return () => {
    loader.dispose();
    plot.destroy();
  };
}
