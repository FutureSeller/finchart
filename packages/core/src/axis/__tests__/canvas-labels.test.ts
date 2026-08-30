import { describe, expect, it } from "vitest";
import { fakeElement } from "../../__tests__/dom-fakes";
import type { PlotArea } from "../../primitives";
import type { TextParams } from "../../render";
import { createCanvasAxisLabels } from "../canvas-labels";
import { DEFAULT_LABEL_COLOR } from "../labels";

const area: PlotArea = { left: 40, right: 780, top: 20, bottom: 560 };
const axes = {
  x: { left: 40, right: 780, top: 560, bottom: 584 },
  y: { left: 4, right: 40, top: 20, bottom: 560 },
};

/** Wiring where the y-axis is on the right — the slice attaches to the right of the data area. */
const rightAxes = {
  x: axes.x,
  y: { left: area.right, right: area.right + 36, top: area.top, bottom: area.bottom },
};

function recordingTarget() {
  const texts: TextParams[] = [];
  return {
    texts,
    target: {
      drawLine: () => undefined,
      drawShape: () => undefined,
      drawText: (params: TextParams) => {
        texts.push(params);
      },
    },
  };
}

function mounted() {
  const { texts, target } = recordingTarget();
  const labels = createCanvasAxisLabels({
    overlay: fakeElement() as unknown as HTMLElement,
    target,
  });
  return { labels, texts };
}

describe("createCanvasAxisLabels", () => {
  it("should place ticks with the same convention as the DOM path", () => {
    const { labels, texts } = mounted();

    labels.render({
      x: [{ value: 0, position: 40, label: "0" }],
      y: [{ value: 10, position: 300, label: "10" }],
      badges: [],
      area,
      axes,
      readStyle: () => "",
    });

    const [x, y] = texts;
    // x: centered on the tick position, 6px below the data area.
    expect(x.at).toEqual({ x: 40, y: area.bottom + 6 });
    expect(x.align).toBe("center");
    expect(x.baseline).toBe("top");
    // y: right-aligned, 6px to the left of the data area.
    expect(y.at).toEqual({ x: area.left - 6, y: 300 });
    expect(y.align).toBe("right");
    expect(y.baseline).toBe("middle");
  });

  /**
   * The right-side y-axis wiring — paired with the same-named test on the
   * DOM path. The DOM uses `translateY(-50%)` while this uses
   * `align: "left"`, so the two representations differ enough that eyes
   * alone can't catch a mismatch — this pins the position (`at.x`) on
   * each side independently.
   */
  it("should place y labels right of the plot when the slice is on the right", () => {
    const { labels, texts } = mounted();

    labels.render({
      x: [],
      y: [{ value: 10, position: 300, label: "10" }],
      badges: [],
      area,
      axes: rightAxes,
      readStyle: () => "",
    });

    const [y] = texts;
    expect(y.at).toEqual({ x: area.right + 6, y: 300 });
    expect(y.align).toBe("left");
    expect(y.baseline).toBe("middle");
  });

  it("should keep y badges on the same side as the ticks", () => {
    const { labels, texts } = mounted();

    labels.render({
      x: [],
      y: [{ value: 10, position: 300, label: "10" }],
      badges: [
        {
          axis: "y",
          position: 300,
          label: "104.40",
          back: "#334155",
          color: "#f8fafc",
        },
      ],
      area,
      axes: rightAxes,
      readStyle: () => "",
    });

    const [tick, badge] = texts;
    expect(badge.at).toEqual(tick.at);
    expect(badge.align).toBe(tick.align);
  });

  it("should resolve style through the css reader", () => {
    const { labels, texts } = mounted();
    const vars: Record<string, string> = {
      "--chart-label": "#123456",
      "--chart-label-font-size": "10px",
      "--chart-label-font-family": "Inter",
    };

    labels.render({
      x: [{ value: 0, position: 40, label: "0" }],
      y: [],
      badges: [],
      area,
      axes,
      readStyle: (name) => vars[name] ?? "",
    });

    expect(texts[0].style).toEqual({ font: "10px Inter", color: "#123456" });
  });

  it("should draw badges with a box, after the ticks", () => {
    const { labels, texts } = mounted();

    labels.render({
      x: [{ value: 0, position: 40, label: "0" }],
      y: [],
      badges: [
        {
          axis: "y",
          position: 300,
          label: "104.40",
          back: "#334155",
          color: "#f8fafc",
        },
      ],
      area,
      axes,
      readStyle: () => "",
    });

    // The badge comes after the ticks — command order is stacking order.
    const badge = texts.at(-1)!;
    expect(badge.text).toBe("104.40");
    expect(badge.box).toEqual({ fill: "#334155", padding: 3 });
    expect(badge.style.color).toBe("#f8fafc");
    // Same positioning convention as the ticks — a y badge is right-aligned to the left of the data area.
    expect(badge.at).toEqual({ x: area.left - 6, y: 300 });
    expect(badge.align).toBe("right");
  });

  it("should fall back to the same defaults the DOM path uses", () => {
    const { labels, texts } = mounted();

    labels.render({
      x: [{ value: 0, position: 40, label: "0" }],
      y: [],
      badges: [],
      area,
      axes,
      readStyle: () => "",
    });

    expect(texts[0].style).toEqual({
      font: "11px sans-serif",
      color: DEFAULT_LABEL_COLOR,
    });
  });
});
