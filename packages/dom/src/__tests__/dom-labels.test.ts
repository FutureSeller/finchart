import { describe, expect, it } from "vitest";
import {
  axisLabelRoot,
  axisLabels,
  fakeElement,
  type FakeElement,
} from "./fakes";
import { AXIS_LABEL_OFFSET, BADGE_PADDING, type PlotArea } from "@finchart/core";
import { createDomAxisLabels } from "../dom-labels";
import type { Tick } from "@finchart/core";

const area: PlotArea = { left: 40, right: 780, top: 20, bottom: 560 };

// Placement is measured from the area's edges. The slice only says
// **which side** — if both are null, left is the default.
const axes = { x: null, y: null };

/** Wiring where the y-axis is on the right — the slice attaches to the right of the data area. */
const rightAxes = {
  x: null,
  y: { left: area.right, right: area.right + 36, top: area.top, bottom: area.bottom },
};

// DOM labels have the browser resolve CSS variables — the resolver belongs to the canvas path.
const readStyle = () => "";

/** The DOM path doesn't use a DrawTarget — this just fills the slot. */
const noopTarget = {
  drawLine: () => undefined,
  drawShape: () => undefined,
  drawText: () => undefined,
};

const xTicks: Tick[] = [
  { value: 0, position: 40, label: "0" },
  { value: 50, position: 410, label: "50" },
];
const yTicks: Tick[] = [
  { value: 0, position: 560, label: "0" },
  { value: 10, position: 20, label: "10" },
];

function overlay() {
  return fakeElement() as unknown as HTMLElement;
}

describe("createDomAxisLabels", () => {
  it("should keep its labels in an isolated container", () => {
    const target = overlay();

    createDomAxisLabels({ overlay: target, target: noopTarget });

    expect(axisLabelRoot(target)).toBeDefined();
  });

  it("should render one element per tick", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: yTicks, badges: [], area, axes, readStyle });

    expect(axisLabels(target)).toHaveLength(4);
  });

  it("should use the formatted tick text", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: yTicks, badges: [], area, axes, readStyle });

    expect(axisLabels(target).map((el) => el.textContent)).toEqual([
      "0",
      "50",
      "0",
      "10",
    ]);
  });

  it("should place x labels below the plot at the tick position", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: [], badges: [], area, axes, readStyle });

    const [first] = axisLabels(target);
    expect(first.style.left).toBe("40px");
    expect(Number.parseFloat(first.style.top)).toBeGreaterThan(area.bottom);
  });

  it("should place y labels left of the plot at the tick position", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: [], y: yTicks, badges: [], area, axes, readStyle });

    const [first] = axisLabels(target);
    expect(first.style.top).toBe("560px");
    expect(Number.parseFloat(first.style.left)).toBeLessThan(area.left);
  });

  /**
   * The right-side y-axis wiring (`YAxisOptions.position: "right"`) —
   * `apps/examples/src/trading.ts` actually runs with this wiring. The
   * canvas-side counterpart is the same-named test in `canvas-labels.test.ts`.
   */
  it("should place y labels right of the plot when the slice is on the right", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({
      x: [],
      y: yTicks,
      badges: [],
      area,
      axes: rightAxes,
      readStyle,
    });

    const [first] = axisLabels(target);
    // 6px to the right of the data area, left-aligned (no horizontal shift).
    expect(first.style.left).toBe(`${area.right + 6}px`);
    expect(first.style.transform).toBe("translateY(-50%)");
    expect(first.style.top).toBe("560px");
  });

  it("should keep y badges on the same side as the ticks", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({
      x: [],
      y: yTicks,
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
      readStyle,
    });

    const rendered = axisLabels(target);
    const badge = rendered.at(-1)!;
    // Same placement convention as the tick — if it diverged, the value box couldn't cover its own tick.
    expect(badge.style.left).toBe(rendered[0].style.left);
    expect(badge.style.transform).toBe(rendered[0].style.transform);
  });

  it("should replace labels instead of appending on re-render", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: yTicks, badges: [], area, axes, readStyle });
    labels.render({ x: xTicks, y: yTicks, badges: [], area, axes, readStyle });

    expect(axisLabels(target)).toHaveLength(4);
  });

  it("should not disturb sibling annotations in the overlay", () => {
    const target = overlay();
    const annotation = fakeElement("div");
    (target as unknown as FakeElement).appendChild(annotation);

    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });
    labels.render({ x: xTicks, y: yTicks, badges: [], area, axes, readStyle });
    labels.clear();

    expect((target as unknown as FakeElement).children).toContain(annotation);
  });

  it("should remove only its own container on destroy", () => {
    const target = overlay();
    const annotation = fakeElement("div");
    (target as unknown as FakeElement).appendChild(annotation);

    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });
    labels.destroy();

    expect(axisLabelRoot(target)).toBeUndefined();
    expect((target as unknown as FakeElement).children).toEqual([annotation]);
  });

  it("should inherit the host page font family by default", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: [], badges: [], area, axes, readStyle });

    const [first] = axisLabels(target);
    expect(first.style.fontFamily).toContain("inherit");
    expect(first.style.font).toBeUndefined();
  });

  it("should size labels from the label font-size variable", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: [], badges: [], area, axes, readStyle });

    const [first] = axisLabels(target);
    expect(first.style.fontSize).toContain("--chart-label-font-size");
    labels.destroy();
  });

  it("should pad a badge so its text does not touch the box edge", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({
      x: [],
      y: [],
      badges: [{ axis: "y", position: 300, label: "104.40", back: "#334155", color: "#f8fafc" }],
      area,
      axes,
      readStyle,
    });

    const [badge] = axisLabels(target);
    expect(badge.style.padding).toBe(`${BADGE_PADDING}px ${BADGE_PADDING}px`);
    labels.destroy();
  });

  it("should let pointer events pass through", () => {
    const target = overlay();
    createDomAxisLabels({ overlay: target, target: noopTarget });

    expect(axisLabelRoot(target)?.style.pointerEvents).toBe("none");
  });

  it("should paint badges after the ticks so they cover them", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({
      x: xTicks,
      y: [],
      badges: [
        {
          axis: "x",
          position: 40,
          label: "11/7",
          back: "#334155",
          color: "#f8fafc",
        },
      ],
      area,
      axes,
      readStyle,
    });

    const rendered = axisLabels(target);
    // The badge is the last child — at the same z, document order is the stacking order, so it covers the tick.
    const badge = rendered.at(-1)!;
    expect(badge.textContent).toBe("11/7");
    expect(badge.style.background).toBe("#334155");
    expect(badge.style.color).toBe("#f8fafc");
    // Same placement convention as the tick — an x badge sits centered below the axis.
    expect(badge.style.left).toBe("40px");
    expect(badge.style.top).toBe(`${area.bottom + AXIS_LABEL_OFFSET}px`);
    expect(badge.style.transform).toBe("translateX(clamp(0px, -50%, calc(740px - 100%)))");
  });

  /**
   * **An edge tick's label stays on the chart.** Centred on a tick at the
   * data area's edge, half of it hung past the chart and was cut off. The
   * centring is clamped in CSS — no layout read — between the data area's
   * left edge and the y gutter's right edge.
   */
  it("clamps x labels inside the data area and the y gutter", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });

    labels.render({ x: xTicks, y: [], badges: [], area, axes: rightAxes, readStyle });

    expect(axisLabels(target).map((label) => label.style.transform)).toEqual([
      "translateX(clamp(0px, -50%, calc(776px - 100%)))",
      "translateX(clamp(-370px, -50%, calc(406px - 100%)))",
    ]);
  });

  it("lets x labels spread into a left y gutter", () => {
    const target = overlay();
    const labels = createDomAxisLabels({ overlay: target, target: noopTarget });
    const leftAxes = {
      x: null,
      y: { left: 0, right: area.left, top: area.top, bottom: area.bottom },
    };

    labels.render({ x: xTicks, y: [], badges: [], area, axes: leftAxes, readStyle });

    // The left bound is the gutter's left edge (0), not the data area's (40).
    expect(axisLabels(target).map((label) => label.style.transform)).toEqual([
      "translateX(clamp(-40px, -50%, calc(740px - 100%)))",
      "translateX(clamp(-410px, -50%, calc(370px - 100%)))",
    ]);
    labels.destroy();
  });
});

