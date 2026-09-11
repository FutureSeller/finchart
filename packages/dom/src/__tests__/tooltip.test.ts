// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "@finchart/core";
import { recordingRenderer } from "@finchart/core";
import { lineSeries } from "@finchart/core";
import { legend } from "../legend";
import { tooltip } from "../tooltip";
import {
  createPlotModel,
  createPlotDeps,
  DEFAULT_PADDING,
  Plot,
} from "@finchart/core";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

/** A real jsdom overlay + the recording renderer — tests DOM plugins without a canvas. */
function mounted() {
  const overlay = document.createElement("div");
  const recorder = recordingRenderer();

  const plot = new Plot({
    deps: createPlotDeps({
      createLayers: (width, height) => {
        const size = { width, height };
        return {
          data: {
            get width() {
              return size.width;
            },
            get height() {
              return size.height;
            },
          },
          overlay,
          resize(nextWidth, nextHeight) {
            size.width = nextWidth;
            size.height = nextHeight;
          },
          destroy() {},
        };
      },
      createRenderer: recorder.factory,
      createStyleReader: () => () => "",
    }),
    config: { padding: DEFAULT_PADDING, showGrid: false },
    size: { width: 800, height: 600 },
  });
  const handle = plot.mainPane.addSeries({
    series: lineSeries(),
    data,
    name: "BTC",
    color: "#f59e0b",
  });

  const tooltipBox = () =>
    overlay.querySelector("[data-chart-tooltip]") as HTMLElement;
  const paneCenter = () => {
    const { area } = plot.mainPane;
    return {
      x: (area.left + area.right) / 2,
      y: (area.top + area.bottom) / 2,
    };
  };

  return { plot, handle, overlay, tooltipBox, paneCenter };
}

describe("tooltip", () => {
  it("should show the series values under the cursor", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());

    plot.crosshair(paneCenter());

    const box = tooltipBox();
    expect(box.style.display).toBe("block");
    expect(box.textContent).toContain("BTC: ");
    // The header is the x of the point actually hit.
    expect(box.textContent).toContain("5");
  });

  it("should hide outside every pane", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());

    plot.crosshair(paneCenter());
    plot.crosshair({ x: 1, y: 1 });

    expect(tooltipBox().style.display).toBe("none");
  });

  it("should hide when the cursor leaves the chart", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());
    plot.crosshair(paneCenter());
    expect(tooltipBox().style.display).toBe("block");

    plot.crosshair(null);

    expect(tooltipBox().style.display).toBe("none");
  });

  it("should refresh on render so setData replaces stale values", () => {
    const { plot, handle, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());

    plot.crosshair(paneCenter());
    expect(tooltipBox().textContent).toContain("120.00");

    // The cursor stayed put, but switching symbols swapped the entire dataset (dogfooding #6).
    handle.setData([
      { x: 0, y: 100 },
      { x: 5, y: 300 },
      { x: 10, y: 110 },
    ]);
    plot.render();

    expect(tooltipBox().textContent).toContain("300.00");
    expect(tooltipBox().textContent).not.toContain("120.00");
  });

  it("should stay hidden through a render after the cursor left", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());

    plot.crosshair(paneCenter());
    plot.crosshair({ x: 1, y: 1 });
    plot.render();

    expect(tooltipBox().style.display).toBe("none");
  });

  it("should honour the formatters", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(
      tooltip({
        formatX: (x) => `#${x}`,
        formatValue: (value) => `${value.toFixed(0)}won`,
      }),
    );

    plot.crosshair(paneCenter());

    expect(tooltipBox().textContent).toContain("#5");
    expect(tooltipBox().textContent).toContain("120won");
  });

  it("should never interpret a name as markup", () => {
    const { plot, handle, tooltipBox, paneCenter } = mounted();
    handle.dispose();
    plot.mainPane.addSeries({
      series: lineSeries(),
      data,
      name: "<img src=x onerror=alert(1)>",
    });
    plot.use(tooltip());

    plot.crosshair(paneCenter());

    // A name is text — there's no innerHTML injection path.
    expect(tooltipBox().querySelector("img")).toBeNull();
    expect(tooltipBox().textContent).toContain("<img");
  });

  it("should leave the overlay clean on dispose", () => {
    const { plot, overlay, paneCenter } = mounted();
    const installed = plot.use(tooltip());
    plot.crosshair(paneCenter());

    installed.dispose();

    expect(overlay.querySelector("[data-chart-tooltip]")).toBeNull();
  });

  it("should refuse a headless stage", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 } });

    expect(() => model.plot.use(tooltip())).toThrow(/headless/);
  });
});

describe("legend", () => {
  it("should list named series with cursor-following values", () => {
    const { plot, paneCenter, overlay } = mounted();
    plot.use(legend());

    const box = () =>
      overlay.querySelector("[data-chart-legend]") as HTMLElement;
    // Even without a cursor, the last value shows.
    expect(box().textContent).toContain("BTC 110.00");

    plot.crosshair(paneCenter());
    expect(box().textContent).toContain("BTC 120.00");

    // Leaving the chart reverts to the last value.
    plot.crosshair({ x: 1, y: 1 });
    expect(box().textContent).toContain("BTC 110.00");
  });

  it("should skip unnamed registrations", () => {
    const { plot, overlay } = mounted();
    plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 1 }],
    });
    plot.use(legend());

    const box = overlay.querySelector("[data-chart-legend]") as HTMLElement;
    // Only the one with a name (BTC).
    expect(box.textContent).not.toBeNull();
    expect(box.children).toHaveLength(1);
  });
});
