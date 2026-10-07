import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { createPlotModel } from "../../plot";
import { LogScale } from "../../scale";
import { isLinearGradientParams, LINEAR_GRADIENT } from "../../render";
import { areaSeries } from "../area-series";
import { baselineSeries, splitAtBaseline } from "../baseline-series";

function mounted(series: Parameters<typeof createPlotModel>[0]["series"]) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series,
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });

  return {
    model,
    polygons: model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "polygon"),
    lines: model.commands().filter((c) => c.type === "drawLine"),
  };
}

describe("areaSeries", () => {
  const data: LineDataPoint[] = [
    { x: 0, y: 10 },
    { x: 1, y: 20 },
    { x: 2, y: null },
    { x: 3, y: 15 },
    { x: 4, y: 25 },
  ];

  it("should split the fill at holes — same rule as the line", () => {
    const { polygons, lines } = mounted({ series: areaSeries(), data });

    expect(polygons).toHaveLength(2);
    expect(lines).toHaveLength(2);
  });

  it("should close each fill down to the plot bottom", () => {
    const { model, polygons } = mounted({ series: areaSeries(), data });

    const bottom = model.plot.mainPane.area.bottom;
    for (const polygon of polygons) {
      if (polygon.type !== "drawShape" || polygon.shape.shape !== "polygon")
        continue;
      const ys = polygon.shape.points.map((point) => point.y);
      expect(Math.max(...ys)).toBeCloseTo(bottom, 6);
    }
  });

  it("should stay a flat fill without fillBottom — no custom command", () => {
    const { model } = mounted({ series: areaSeries(), data });

    expect(model.commands().some((c) => c.type === "custom")).toBe(false);
  });

  describe("fillBottom — vertical gradient", () => {
    const gradients = (model: ReturnType<typeof mounted>["model"]) =>
      model
        .commands()
        .flatMap((c) =>
          c.type === "custom" &&
          c.name === LINEAR_GRADIENT &&
          isLinearGradientParams(c.params)
            ? [{ params: c.params, fallback: c.fallback }]
            : [],
        );

    it("should turn the fill into one gradient per run", () => {
      const { model, polygons } = mounted({
        series: areaSeries({ fillBottom: "rgba(59, 130, 246, 0)" }),
        data,
      });

      expect(gradients(model)).toHaveLength(2); // a hole splits the fill too
      expect(polygons).toHaveLength(0); // the solid fill has been replaced by a gradient
    });

    it("should anchor every run to the pane, not to its own bbox", () => {
      const { model } = mounted({
        series: areaSeries({ fillBottom: "rgba(59, 130, 246, 0)" }),
        data,
      });

      const area = model.plot.mainPane.area;
      for (const { params } of gradients(model)) {
        expect(params.from.y).toBeCloseTo(area.top, 6);
        expect(params.to.y).toBeCloseTo(area.bottom, 6);
      }
    });

    it("should run from the fill color down to fillBottom", () => {
      const { model } = mounted({
        series: areaSeries({
          fill: "rgba(1, 2, 3, 0.5)",
          fillBottom: "rgba(1, 2, 3, 0)",
        }),
        data,
      });

      const [{ params, fallback }] = gradients(model);
      expect(params.stops).toEqual([
        { offset: 0, color: "rgba(1, 2, 3, 0.5)" },
        { offset: 1, color: "rgba(1, 2, 3, 0)" },
      ]);
      // A surface that doesn't understand gradients falls back to a solid
      // fill of the top color.
      expect(fallback?.[0]).toMatchObject({
        type: "drawShape",
        shape: { shape: "polygon", fill: "rgba(1, 2, 3, 0.5)" },
      });
    });

    it("should read --chart-area-bottom like any other token", () => {
      const model = createPlotModel({
        size: { width: 800, height: 600 },
        series: { series: areaSeries(), data },
        config: {
          showGrid: false,
          axis: { x: { showLabels: false }, y: { showLabels: false } },
        },
        deps: {
          createStyleReader: () => (name) =>
            name === "--chart-area-bottom" ? "rgba(0, 0, 0, 0)" : "",
        },
      });

      expect(
        model.commands().some((c) => c.type === "custom" && c.name === LINEAR_GRADIENT),
      ).toBe(true);
    });
  });
});

describe("baselineSeries", () => {
  it.each([false, true])("should keep threshold colors and crossing geometry when inverted (log: %s)", (logarithmic) => {
    const data: LineDataPoint[] = [{ x: 0, y: 20 }, { x: 1, y: 5 }, { x: 2, y: 20 }];
    const { model } = mounted({
      series: baselineSeries({
        baseline: 10,
        style: { topLine: "green", topFill: "lime", bottomLine: "red", bottomFill: "pink" },
      }),
      data,
    });
    if (logarithmic) model.plot.mainPane.setYScale(new LogScale());
    const colors = () => model.commands().flatMap((command) => {
      if (command.type === "drawLine") return [command.style.color];
      if (command.type === "drawShape" && command.shape.shape === "polygon") return [command.shape.fill];
      return [];
    });
    const expected = ["lime", "green", "pink", "red", "lime", "green"];
    expect(colors()).toEqual(expected);
    model.plot.mainPane.applyOptions({ invert: true });
    expect(colors()).toEqual(expected);
    const lines = model.commands().filter((command) => command.type === "drawLine");
    expect(lines[0].points.at(-1)).toEqual(lines[1].points[0]);
    expect(lines[1].points.at(-1)).toEqual(lines[2].points[0]);
    expect(lines[0].points.at(-1)?.y).toBeCloseTo(model.plot.mainPane.yScale.scale(10), 6);
    model.plot.destroy();
  });

  it("should keep a baseline-only run on the same side after inversion", () => {
    const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 1, y: 10 }];
    const { model } = mounted({ series: baselineSeries({ baseline: 10 }), data });
    const colors = () => model.commands().flatMap(command => command.type === "drawLine" ? [command.style.color] : []);
    const expected = colors();
    model.plot.mainPane.applyOptions({ invert: true });
    expect(colors()).toEqual(expected);
    model.plot.destroy();
  });

  it("should change color exactly at the crossing, not at a bar", () => {
    // baseline at y=0. 30 → -10 crosses it three quarters of the way
    // along — asymmetric, so measuring t from the wrong end shows up.
    const data: LineDataPoint[] = [
      { x: 0, y: 30 },
      { x: 1, y: -10 },
    ];
    const { model, lines } = mounted({ series: baselineSeries(), data });

    expect(lines).toHaveLength(2);
    const [above, below] = lines;
    if (above.type !== "drawLine" || below.type !== "drawLine") {
      throw new Error("expected two drawLine commands");
    }

    // The two lines meet at the same point (the crossing) — that y is the
    // baseline's screen y, and its x is 3/4 of the way from the first
    // point to the last.
    const seam = above.points.at(-1)!;
    expect(below.points[0]).toEqual(seam);
    expect(seam.y).toBeCloseTo(model.plot.mainPane.yScale.scale(0), 6);
    const startX = above.points[0].x;
    const endX = below.points.at(-1)!.x;
    expect(seam.x).toBeCloseTo(startX + (endX - startX) * 0.75, 6);
    // The colors differ.
    expect(above.style.color).not.toBe(below.style.color);
    model.plot.destroy();
  });

  it("should keep a graze on the baseline in one segment", () => {
    const runs = splitAtBaseline(
      [
        { x: 0, y: 10 },
        { x: 1, y: 50 },
        { x: 2, y: 10 },
      ],
      50, // screen y — the middle point sits exactly on the baseline.
    );

    // It only grazes — the run doesn't split into a one-point sliver.
    expect(runs).toHaveLength(1);
    expect(runs[0].side).toBe("above");
  });

  it("should fill above and below with different colors", () => {
    const data: LineDataPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: -10 },
      { x: 2, y: 10 },
    ];
    const { polygons } = mounted({ series: baselineSeries(), data });

    const fills = new Set(
      polygons.map((polygon) =>
        polygon.type === "drawShape" && polygon.shape.shape === "polygon"
          ? polygon.shape.fill
          : "",
      ),
    );
    expect(polygons).toHaveLength(3);
    expect(fills.size).toBe(2);
  });
});
