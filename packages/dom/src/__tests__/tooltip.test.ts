// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineDataPoint } from "@finchart/core";
import { recordingRenderer } from "@finchart/core";
import { candleSeries, lineSeries } from "@finchart/core";
import type { OHLC, SeriesSample } from "@finchart/core";
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

  it("should mark the row with a dot in its series colour", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());

    plot.crosshair(paneCenter());

    const dot = tooltipBox().querySelector("span");
    expect(dot?.textContent).toBe("● ");
    // jsdom reports the colour in its computed rgb() form.
    expect(dot?.style.color).toBe("rgb(245, 158, 11)");
    plot.destroy();
  });

  it("should redraw the shown box when options change, without waiting for the cursor", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    const installed = plot.use(tooltip());
    plot.crosshair(paneCenter());
    expect(tooltipBox().textContent).toContain("120.00");

    installed.applyOptions({ formatValue: (value) => `${value.toFixed(0)}won` });

    expect(tooltipBox().textContent).toContain("120won");
    plot.destroy();
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

  it("should stop following crosshair and render events once disposed", () => {
    const { plot, handle, overlay, paneCenter } = mounted();
    const installed = plot.use(tooltip());
    plot.crosshair(paneCenter());
    const box = overlay.querySelector<HTMLElement>("[data-chart-tooltip]");
    expect(box?.textContent).toContain("120.00");

    installed.dispose();
    handle.setData([
      { x: 0, y: 100 },
      { x: 5, y: 300 },
      { x: 10, y: 110 },
    ]);
    plot.render();
    plot.crosshair(null);

    // A listener left behind would keep rebuilding the removed box.
    expect(box?.textContent).toContain("120.00");
    expect(box?.style.display).toBe("block");
    plot.destroy();
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

  it("should read in the page's text color until a theme sets one", () => {
    const { plot, overlay } = mounted();
    plot.use(legend());

    // A fixed dark default vanished on a dark page.
    expect(overlay.querySelector<HTMLElement>("[data-chart-legend]")?.style.color).toBe("var(--chart-legend, inherit)");
  });

  it("should leave the overlay and stop following crosshair and render events once disposed", () => {
    const { plot, handle, overlay, paneCenter } = mounted();
    const installed = plot.use(legend());
    const box = overlay.querySelector<HTMLElement>("[data-chart-legend]");
    expect(box?.textContent).toContain("BTC 110.00");

    installed.dispose();
    expect(overlay.querySelector("[data-chart-legend]")).toBeNull();
    plot.crosshair(paneCenter());
    handle.setData([
      { x: 0, y: 100 },
      { x: 5, y: 120 },
      { x: 10, y: 300 },
    ]);
    plot.render();

    // A listener left behind would keep rebuilding the removed box.
    expect(box?.textContent).toBe("● BTC 110.00");
    plot.destroy();
  });
});

describe("rows a series describes — tooltip and legend", () => {
  const candles: OHLC[] = [
    { x: 0, open: 100, high: 110, low: 95, close: 105, volume: 1200 },
    { x: 5, open: 105, high: 112, low: 101, close: 102, volume: 800 },
    { x: 10, open: 102, high: 108, low: 99, close: 107, volume: 950 },
  ];

  it("tooltip draws a candle's O/H/L/C/V after its name", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.mainPane.addSeries({ series: candleSeries(), data: candles, name: "SOXL" });
    plot.use(tooltip());
    plot.crosshair(paneCenter());
    const text = tooltipBox().textContent ?? "";
    expect(text).toContain("SOXL: O 105");
    for (const part of ["O 105", "H 112", "L 101", "C 102", "V 800"]) expect(text).toContain(part);
    // The line series on the same pane keeps its one-line shape.
    expect(text).toContain("BTC: ");
  });

  it("formats each row through the row-aware formatRow — the volume can read differently from a price", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.mainPane.addSeries({ series: candleSeries(), data: candles, name: "SOXL" });
    const seen: string[] = [];
    plot.use(
      tooltip({
        formatValue: (value: number) => {
          seen.push("-");
          return value.toFixed(2);
        },
        formatRow: (value: number, row: { label: string; sample: SeriesSample }) => {
          seen.push(row.label);
          return row.label === "V" ? `${value / 100}k` : value.toFixed(1);
        },
      }),
    );
    plot.crosshair(paneCenter());
    const text = tooltipBox().textContent ?? "";
    expect(text).toContain("V 8k");
    expect(text).toContain("C 102.0");
    expect(seen).toContain("V");
    // The scalar (line) row still formats through formatValue, with no row.
    expect(seen).toContain("-");
    expect(text).toContain("BTC: 120.00");
  });

  it("draws a null row as — and does not call the formatter for it", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    const nulled = Object.assign(lineSeries(), { describe: () => [{ label: "gap", value: null }] });
    plot.mainPane.addSeries({ series: nulled, data, name: "N" });
    const calls: unknown[] = [];
    plot.use(tooltip({ formatValue: (value: number) => { calls.push(value); return String(value); } }));
    plot.crosshair(paneCenter());
    expect(tooltipBox().textContent).toContain("gap —");
    expect(calls).not.toContain(null);
  });

  it("draws a described series with no name as its rows alone, and hands formatRow the sample it belongs to", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.mainPane.addSeries({ series: candleSeries(), data: candles });
    const seen: (string | null)[] = [];
    plot.use(
      tooltip({
        formatRow: (value: number, row: { label: string; sample: SeriesSample }) => {
          seen.push(row.sample.name);
          return String(value);
        },
      }),
    );
    plot.crosshair(paneCenter());
    const text = tooltipBox().textContent ?? "";
    expect(text).not.toContain("null");
    expect(text).toContain("O 105 H 112 L 101 C 102 V 800");
    expect(seen).toContain(null);
  });

  it("legend draws the rows too, null as —", () => {
    const { plot, overlay } = mounted();
    plot.mainPane.addSeries({ series: candleSeries(), data: candles, name: "SOXL" });
    const nulled = Object.assign(lineSeries(), { describe: () => [{ label: "gap", value: null }] });
    plot.mainPane.addSeries({ series: nulled, data, name: "N" });
    plot.use(legend({ formatValue: (value: number) => value.toFixed(0), formatRow: (value: number, row: { label: string }) => (row.label === "V" ? "vol" : value.toFixed(0)) }));
    plot.render();
    const box = overlay.querySelector("[data-chart-legend]");
    if (!(box instanceof HTMLElement)) throw new Error("legend box expected");
    const text = box.textContent ?? "";
    expect(text).toContain("SOXL");
    expect(text).toContain("V vol");
    expect(text).toContain("C 107");
    expect(text).toContain("gap —");
  });
});

describe("readout: false — a registration drawn for the eye", () => {
  it("tooltip leaves it out and keeps every other row, named or not", () => {
    const { plot, tooltipBox, paneCenter } = mounted();
    plot.mainPane.addSeries({ series: lineSeries(), data: data.map((point) => ({ ...point, y: 999 })), name: "fill", readout: false });
    const bars: OHLC[] = data.map((point) => ({ x: point.x, open: 105, high: 112, low: 101, close: 102 }));
    plot.mainPane.addSeries({ series: candleSeries(), data: bars });
    plot.use(tooltip());
    plot.crosshair(paneCenter());

    const box = tooltipBox();
    expect(box.style.display).toBe("block");
    const text = box.textContent ?? "";
    expect(text).toContain("BTC: ");
    expect(text).toContain("O 105");
    expect(text).not.toContain("fill");
    expect(text).not.toContain("999");
  });

  it("tooltip takes its header from the samples it shows, not from one it left out", () => {
    const { plot, handle, tooltipBox, paneCenter } = mounted();
    handle.dispose();
    // Registered first, and its nearest point sits at a different x.
    plot.mainPane.addSeries({ series: lineSeries(), data: data.map((point) => ({ ...point, x: point.x + 1 })), readout: false });
    plot.mainPane.addSeries({ series: lineSeries(), data, name: "S" });
    plot.use(tooltip({ formatX: (x) => `x=${x}` }));
    plot.crosshair(paneCenter());
    const header = tooltipBox().firstChild;
    expect(header?.textContent).toBe("x=5");
  });

  it("tooltip hides when every sample under the cursor is left out", () => {
    const { plot, handle, tooltipBox, paneCenter } = mounted();
    handle.dispose();
    plot.mainPane.addSeries({ series: lineSeries(), data, readout: false });
    plot.use(tooltip());
    plot.crosshair(paneCenter());
    expect(tooltipBox().style.display).toBe("none");
  });

  it("legend leaves it out even when it has a name", () => {
    const { plot, overlay } = mounted();
    plot.mainPane.addSeries({ series: lineSeries(), data, name: "fill", readout: false });
    plot.use(legend());
    const box = overlay.querySelector("[data-chart-legend]");
    expect(box?.textContent ?? "").toContain("BTC");
    expect(box?.textContent ?? "").not.toContain("fill");
  });
});

describe("tooltip and legend after the view moves under a still cursor", () => {
  it("read the bar now under the cursor, as the crosshair line does", () => {
    const { plot, overlay, tooltipBox, paneCenter } = mounted();
    plot.use(tooltip());
    plot.use(legend());
    plot.setVisibleRange(0, 10);
    plot.render();
    plot.crosshair(paneCenter());
    expect(tooltipBox().textContent).toContain("120.00");

    // A keyboard pan, a live feed shift or a linked chart moves the view; the pointer stays.
    plot.setVisibleRange(5, 15);
    plot.render();

    expect(tooltipBox().textContent).toContain("110.00");
    const legendBox = overlay.querySelector("[data-chart-legend]") as HTMLElement;
    expect(legendBox.textContent).toContain("110.00");
  });
});

describe("tooltip placement", () => {
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  afterEach(() => {
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  });

  let measured = 0;

  /**
   * jsdom has no layout: a 270×80 box (a candle row's real width) in an
   * overlay twice the chart's size — a container wider and taller than the
   * chart, so flipping against the overlay would still run past the chart.
   */
  function laidOut() {
    const mount = mounted();
    measured = 0;
    Object.defineProperty(mount.overlay, "clientWidth", { value: 1600 });
    Object.defineProperty(mount.overlay, "clientHeight", { value: 1200 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => (measured++, 270) });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 80 });
    mount.plot.use(tooltip());
    const rect = () => {
      const box = mount.tooltipBox();
      const left = Number.parseFloat(box.style.left);
      const top = Number.parseFloat(box.style.top);
      return { left, top, right: left + 270, bottom: top + 80 };
    };
    return { ...mount, rect };
  }

  it("should stay inside the chart near the right edge, whatever the box's width", () => {
    const { plot, rect } = laidOut();
    const { area } = plot.mainPane;

    plot.crosshair({ x: area.right - 200, y: area.top + 20 });

    expect(rect().right).toBeLessThanOrEqual(area.right);
    expect(rect().left).toBeGreaterThanOrEqual(0);
  });

  it("should flip above the cursor near the bottom edge", () => {
    const { plot, rect } = laidOut();
    const { area } = plot.mainPane;

    plot.crosshair({ x: area.left + 20, y: area.bottom - 10 });

    expect(rect().bottom).toBeLessThanOrEqual(area.bottom);
  });

  it("should not measure the box again while its rows read the same", () => {
    const { plot, rect } = laidOut();
    const { area } = plot.mainPane;
    plot.crosshair({ x: area.right - 200, y: area.top + 20 });
    const before = measured;

    // A live chart renders every tick under a still pointer; each measure is a forced layout.
    plot.render();
    plot.render();

    expect(measured).toBe(before);
    expect(rect().right).toBeLessThanOrEqual(area.right);
  });

  it("remeasures and repositions unchanged rows after a font change", () => {
    const { plot, tooltipBox } = laidOut();
    let width = 100;
    let fontSize = "11px";
    const computed = window.getComputedStyle.bind(window);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      return element === tooltipBox()
        ? { ...style, fontSize } as CSSStyleDeclaration
        : style;
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => width });
    const { area } = plot.mainPane;
    const cursorX = area.right - 150;
    plot.crosshair({ x: cursorX, y: area.top + 20 });
    expect(Number.parseFloat(tooltipBox().style.left)).toBe(cursorX + 12);

    width = 270;
    fontSize = "24px";
    plot.render();
    expect(Number.parseFloat(tooltipBox().style.left)).toBe(cursorX - 12 - 270);
    styleSpy.mockRestore();
  });

  it("should sit below and to the right of the cursor where there is room", () => {
    const { plot, rect } = laidOut();
    const { area } = plot.mainPane;

    plot.crosshair({ x: area.left + 20, y: area.top + 20 });

    expect(rect()).toMatchObject({ left: area.left + 32, top: area.top + 32 });
  });
});
