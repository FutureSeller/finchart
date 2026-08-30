import { describe, expect, it } from "vitest";
import type { AxisBadge, AxisLabelsInput } from "../../axis";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { crosshair } from "../../extensions/crosshair";
import type { PlotDecoration } from "../decoration";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function labelSpy() {
  const seen: AxisLabelsInput[] = [];

  return {
    seen,
    createAxisLabels: () => ({
      render: (input: AxisLabelsInput) => {
        seen.push(input);
      },
      clear: () => undefined,
      destroy: () => undefined,
    }),
  };
}

function badgeDecoration(badges: AxisBadge[]): PlotDecoration {
  return {
    draw: () => undefined,
    axisBadges: () => badges,
  };
}

const badge = (axis: "x" | "y", label = "B"): AxisBadge => ({
  axis,
  position: 100,
  label,
  back: "#000",
  color: "#fff",
});

describe("axis badges", () => {
  it("should hand decoration badges to the label renderer", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({ deps, series: lineSeries() });
    handle.setData(data);

    plot.addDecoration(badgeDecoration([badge("x", "11/7"), badge("y", "104")]));

    const { badges } = spy.seen.at(-1)!;
    expect(badges.map((entry) => entry.label)).toEqual(["11/7", "104"]);
  });

  it("should drop badges for an axis that has no room", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({
      deps,
      series: lineSeries(),
      // x labels are turned off — with no x-axis slice, an x badge has nowhere to draw.
      config: { ...defaultConfig, axis: { x: { showLabels: false } } },
    });
    handle.setData(data);

    plot.addDecoration(badgeDecoration([badge("x"), badge("y")]));

    const { badges } = spy.seen.at(-1)!;
    expect(badges.map((entry) => entry.axis)).toEqual(["y"]);
  });
});

describe("crosshair axis badges", () => {
  function withCursor(options: Parameters<typeof crosshair>[0] = {}) {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({ deps, series: lineSeries() });
    handle.setData(data);
    plot.use(crosshair(options));

    return {
      spy,
      moveTo(x: number, y: number) {
        plot.crosshair({ x, y });
        plot.render();
      },
      paneCenter() {
        const { area } = plot.mainPane;
        return {
          x: (area.left + area.right) / 2,
          y: (area.top + area.bottom) / 2,
        };
      },
    };
  }

  it("should describe the cursor on both axes", () => {
    const { spy, moveTo, paneCenter } = withCursor({
      format: { x: (x) => `x=${x.toFixed(0)}`, y: (v) => `y=${v.toFixed(0)}` },
    });

    const center = paneCenter();
    moveTo(center.x, center.y);

    const { badges } = spy.seen.at(-1)!;
    expect(badges.map((entry) => entry.axis)).toEqual(["x", "y"]);
    // Pane center = data x center (50), and the middle of the value domain.
    expect(badges[0].label).toBe("x=50");
    expect(badges[0].position).toBe(center.x);
    expect(badges[1].label.startsWith("y=")).toBe(true);
  });

  it("should say nothing while the cursor is off the chart", () => {
    const { spy, moveTo, paneCenter } = withCursor();

    const center = paneCenter();
    moveTo(center.x, center.y);
    // Moving outside the pane (into the padding) triggers follow(null) — the badges vanish with it.
    moveTo(1, 1);

    expect(spy.seen.at(-1)!.badges).toEqual([]);
  });

  it("should stay quiet when badges are turned off", () => {
    const { spy, moveTo, paneCenter } = withCursor({ badges: false });

    const center = paneCenter();
    moveTo(center.x, center.y);

    expect(spy.seen.at(-1)!.badges).toEqual([]);
  });
});
