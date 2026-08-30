import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import type { XDomainChangePayload } from "../plot";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 25, y: 20 },
  { x: 50, y: 15 },
  { x: 75, y: 30 },
  { x: 100, y: 25 },
];

function mount() {
  const { plot, handle } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig });
  const seen: XDomainChangePayload[] = [];

  plot.on("xDomainChange", (payload) => seen.push(payload));

  return { plot, handle, seen };
}

describe("xDomainChange", () => {
  it("should report the window that setData fitted to", () => {
    const { handle, seen } = mount();

    handle.setData(data);

    expect(seen).toHaveLength(1);
    expect(seen[0].startX).toBe(0);
    expect(seen[0].endX).toBe(100);
  });

  it("should carry the data range so the edge is measurable", () => {
    const { plot, handle, seen } = mount();
    handle.setData(data);

    plot.pan(-40);

    const last = seen.at(-1)!;
    expect(last.dataRange).toEqual({ min: 0, max: 100 });
    // How far past the left edge it went can be measured from the payload alone.
    expect(last.startX - last.dataRange!.min).toBe(-40);
  });

  it("should fire on pan and zoom", () => {
    const { plot, handle, seen } = mount();
    handle.setData(data);
    const before = seen.length;

    plot.pan(10);
    plot.zoom(2, 50);
    plot.panByPixels(30);
    plot.zoomAtPixel(2, 100);

    expect(seen.length - before).toBe(4);
  });

  it("should stay quiet when the window does not actually move", () => {
    const { plot, handle, seen } = mount();
    handle.setData(data);
    const before = seen.length;

    plot.pan(0);
    plot.zoom(1, 50);
    plot.fitDomains(); // everything is already visible

    expect(seen.length).toBe(before);
  });

  it("should stay quiet for data appended without moving the window", () => {
    const { handle, seen } = mount();
    handle.setData(data);
    const before = seen.length;

    // An incremental add does not touch the domain
    handle.append([{ x: 125, y: 5 }]);
    handle.prepend([{ x: -25, y: 5 }]);

    expect(seen.length).toBe(before);
  });

  it("should fire before the frame, not with it", () => {
    const { plot, handle } = mount();
    handle.setData(data);

    const order: string[] = [];
    plot.on("xDomainChange", () => order.push("domain"));
    plot.on("render", () => order.push("render"));

    plot.pan(10);

    // The visible range is state — it doesn't wait for the drawing.
    expect(order).toEqual(["domain", "render"]);
  });

  it("should report null data range before any data arrives", () => {
    const { plot, seen } = mount();

    plot.pan(0.5);

    expect(seen.at(-1)?.dataRange).toBeNull();
  });

  it("should let a handler load more without recursing", () => {
    const { plot, handle } = mount();
    handle.setData(data);

    let loads = 0;
    plot.on("xDomainChange", ({ startX, dataRange }) => {
      if (!dataRange || startX >= dataRange.min) return;
      if (loads >= 3) return;

      loads += 1;
      // prependData does not touch the domain, so this handler is not called again.
      handle.prepend([{ x: dataRange.min - 25, y: 1 }]);
    });

    plot.pan(-30);

    expect(loads).toBe(1);
    expect(handle.xRange?.min).toBe(-25);
  });
});
