import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import type { CrosshairPayload } from "../../plot";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize, mountPlot } from "../../plot/__tests__/helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function twoPanes() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: false,
  } });
  handle.setData(data);

  const lower = plot.addPane({ flex: 1 });
  lower.addSeries(lineSeries());
  plot.fitDomains();

  const seen: CrosshairPayload[] = [];
  plot.on("crosshair", (payload) => seen.push(payload));

  return { plot, xScale, yScale, lower, seen };
}

/** The vertical midpoint of the area. */
const middleY = (area: { top: number; bottom: number }) =>
  (area.top + area.bottom) / 2;

describe("crosshair", () => {
  it("should still report the screen position", () => {
    const { plot, seen } = twoPanes();

    plot.crosshair({ x: 300, y: middleY(plot.mainPane.area) });

    expect(seen.at(-1)!.position).toEqual({
      x: 300,
      y: middleY(plot.mainPane.area),
    });
  });

  it("should say which pane the cursor is over", () => {
    const { plot, lower, seen } = twoPanes();

    plot.crosshair({ x: 300, y: middleY(plot.mainPane.area) });
    expect(seen.at(-1)!.pane).toBe(plot.mainPane);

    plot.crosshair({ x: 300, y: middleY(lower.area) });
    expect(seen.at(-1)!.pane).toBe(lower);
  });

  it("should read the value from that pane's own scale", () => {
    const { plot, yScale, lower, seen } = twoPanes();

    plot.crosshair({ x: 300, y: middleY(lower.area) });

    const payload = seen.at(-1)!;
    expect(payload.value).toBeCloseTo(lower.yScale.invert(middleY(lower.area)));
    // It's the lower pane's scale, not the mainPane's.
    expect(payload.value).not.toBeCloseTo(
      yScale.invert(middleY(lower.area)),
    );
  });

  it("should report a domain x shared by every pane", () => {
    const { plot, xScale, lower, seen } = twoPanes();

    plot.crosshair({ x: 300, y: middleY(plot.mainPane.area) });
    const upper = seen.at(-1)!.x;

    plot.crosshair({ x: 300, y: middleY(lower.area) });

    expect(seen.at(-1)!.x).toBeCloseTo(upper);
    expect(upper).toBeCloseTo(xScale.invert(300));
  });

  it("should report no pane in the gap between panes", () => {
    const { plot, seen } = twoPanes();
    plot.applyOptions({ paneGap: 20 });
    plot.render();

    plot.crosshair({ x: 300, y: plot.mainPane.area.bottom + 10 });

    expect(seen.at(-1)!.pane).toBeNull();
    expect(seen.at(-1)!.value).toBeNull();
  });

  it("should report no pane above the plot area", () => {
    const { plot, seen } = twoPanes();

    plot.crosshair({ x: 300, y: 2 });

    expect(seen.at(-1)!.pane).toBeNull();
  });

  it("should report no pane outside the horizontal extent", () => {
    const { plot, seen } = twoPanes();

    plot.crosshair({ x: 2, y: middleY(plot.mainPane.area) });
    expect(seen.at(-1)!.pane).toBeNull();

    plot.crosshair({
      x: defaultSize.width - 2,
      y: middleY(plot.mainPane.area),
    });
    expect(seen.at(-1)!.pane).toBeNull();
  });

  it("should follow the panes after a resize", () => {
    const { plot, lower, seen } = twoPanes();
    const wasLower = middleY(lower.area);

    // Growing the lower pane means that point is now inside its top edge.
    plot.mainPane.applyOptions({ flex: 1 });
    lower.applyOptions({ flex: 9 });
    plot.render();

    plot.crosshair({ x: 300, y: wasLower });

    expect(seen.at(-1)!.pane).toBe(lower);
    expect(seen.at(-1)!.value).toBeCloseTo(lower.yScale.invert(wasLower));
  });
});

describe("crosshair magnet (2.5)", () => {
  it("should snap the vertical line to the bar under the cursor", async () => {
    const { createPlotModel } = await import("../../plot/model");
    const { lineSeries } = await import("../../series");
    const { crosshair: attach } = await import("../crosshair");

    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: [
          { x: 0, y: 100 },
          { x: 10, y: 120 },
        ],
      },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    model.plot.use(attach({ magnet: true, horizontal: false }));

    const { area } = model.plot.mainPane;
    // Place the cursor in the empty space between bars (x≈3).
    const hover = area.left + (area.right - area.left) * 0.3;
    model.plot.crosshair({ x: hover, y: (area.top + area.bottom) / 2 });
    model.plot.render();

    const vertical = model
      .commands()
      .filter((c) => c.type === "drawLine")
      .find(
        (c) =>
          c.type === "drawLine" &&
          c.points.length === 2 &&
          c.points[0].x === c.points[1].x &&
          c.style.dashArray,
      );
    if (!vertical || vertical.type !== "drawLine") throw new Error("no vertical line found");

    // It lands on the pixel of the nearest bar (x=0), not the cursor position.
    expect(vertical.points[0].x).toBeCloseTo(area.left, 6);
    expect(vertical.points[0].x).not.toBeCloseTo(hover, 6);
  });
});
