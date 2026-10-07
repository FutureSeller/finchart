/**
 * The cursor, end to end.
 *
 * - `plot.crosshair()` — the event payload a cursor position produces
 *   (screen position, pane hit-testing, per-pane value, shared domain x).
 *   This lives in the plot; it is tested here beside its main consumer.
 * - `crosshair()` / `crosshairLine` — what the plugin draws from that
 *   payload: the guide lines, the y badge, and magnet snapping.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import type { CrosshairPayload } from "../../plot";
import { createPlotModel } from "../../plot/model";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize, mountPlot } from "../../plot/__tests__/helpers";
import { crosshair as attach, crosshairLine } from "../crosshair";

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
  // `null` is the cursor leaving — not a position, so not what these read.
  plot.on("crosshair", (payload) => {
    if (payload !== null) seen.push(payload);
  });

  return { plot, xScale, yScale, lower, seen };
}

/** The vertical midpoint of the area. */
const middleY = (area: { top: number; bottom: number }) =>
  (area.top + area.bottom) / 2;

describe("plot.crosshair — the event payload", () => {
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

describe("crosshairLine — what the plugin draws", () => {
  it("should draw the horizontal line at the cursor and badge the y axis with that pane's value", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { showGrid: false, axis: { x: { showLabels: false } } },
    });
    const format = (value: number) => `Y=${value.toFixed(3)}`;
    model.plot.use(attach({ vertical: false, format: { y: format } }));

    const { area, yScale } = model.plot.mainPane;
    // Off-centre on both axes, so a value read from the wrong coordinate shows.
    const cursor = {
      x: area.left + (area.right - area.left) * 0.7,
      y: area.top + (area.bottom - area.top) * 0.25,
    };
    model.plot.crosshair(cursor);
    model.plot.render();
    const commands = model.commands();

    const horizontal = commands.find(
      (c) =>
        c.type === "drawLine" &&
        c.points.length === 2 &&
        c.points[0].y === c.points[1].y &&
        c.style.dashArray,
    );
    if (horizontal?.type !== "drawLine") throw new Error("no horizontal line found");
    expect(horizontal.points).toEqual([
      { x: area.left, y: cursor.y },
      { x: area.right, y: cursor.y },
    ]);

    const label = format(yScale.invert(cursor.y));
    const badge = commands.find((c) => c.type === "drawText" && c.params.text === label);
    if (badge?.type !== "drawText") throw new Error(`no y badge reading ${label}`);
    expect(badge.params.at.y).toBeCloseTo(cursor.y, 6);
    model.plot.destroy();
  });
});

/**
 * `crosshairLine` is public, so a host can feed it any position — one over
 * an axis strip included. A guide line has no place outside the area it
 * spans, so each direction is dropped on its own once the cursor leaves it.
 */
describe("crosshairLine — a position outside the area", () => {
  function guidesAt(position: (area: { left: number; right: number; top: number; bottom: number }) => { x: number; y: number }) {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    const line = crosshairLine();
    model.plot.addDecoration(line);
    line.follow(position(model.plot.mainPane.area));
    model.plot.render();

    // The guides are the dashed two-point lines; the series line is solid.
    const guides = model
      .commands()
      .flatMap((c) => (c.type === "drawLine" && c.points.length === 2 && c.style.dashArray ? [c.points] : []));
    const result = {
      vertical: guides.filter(([from, to]) => from.x === to.x).length,
      horizontal: guides.filter(([from, to]) => from.y === to.y).length,
    };
    model.plot.destroy();
    return result;
  }

  const midY = (area: { top: number; bottom: number }) => (area.top + area.bottom) / 2;
  const midX = (area: { left: number; right: number }) => (area.left + area.right) / 2;

  it("should drop the vertical guide left or right of the area and keep the horizontal one", () => {
    expect(guidesAt((area) => ({ x: area.left - 5, y: midY(area) }))).toEqual({ vertical: 0, horizontal: 1 });
    expect(guidesAt((area) => ({ x: area.right + 5, y: midY(area) }))).toEqual({ vertical: 0, horizontal: 1 });
  });

  it("should drop the horizontal guide above or below the area and keep the vertical one", () => {
    expect(guidesAt((area) => ({ x: midX(area), y: area.top - 5 }))).toEqual({ vertical: 1, horizontal: 0 });
    expect(guidesAt((area) => ({ x: midX(area), y: area.bottom + 5 }))).toEqual({ vertical: 1, horizontal: 0 });
  });
});

describe("crosshair plugin — magnet", () => {
  it("should snap the vertical line to the bar under the cursor", () => {
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
    model.plot.destroy();
  });
});
