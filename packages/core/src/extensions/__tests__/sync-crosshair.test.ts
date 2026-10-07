/**
 * `syncCrosshair` — does cursor time cross between stages.
 *
 * Contract: hovering on one stage raises a time ghost (a vertical line
 * plus an x badge) on the rest, never on the originating stage itself
 * (which has the real crosshair), clears when the cursor leaves, and the
 * decoration disappears on release. Only the data x moves across.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { syncCrosshair } from "../sync";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 50, y: 120 },
  { x: 100, y: 110 },
];

const bare = {
  showGrid: false,
  axis: { x: { showLabels: false as const }, y: { showLabels: false as const } },
};

function trio() {
  const make = () =>
    createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: bare,
    });
  return { a: make(), b: make(), c: make() };
}

/** A line spanning the full height — the fingerprint of a ghost cursor. */
function fullHeightVerticals(model: ReturnType<typeof createPlotModel>) {
  const area = model.plot.mainPane.area;
  return model
    .commands()
    .flatMap((c) => (c.type === "drawLine" ? [c.points] : []))
    .filter(
      (points) =>
        points.length === 2 &&
        points[0].x === points[1].x &&
        points[0].y <= area.top + 1,
    );
}

describe("syncCrosshair", () => {
  it("should raise a time ghost on the other plots at the same data x", () => {
    const { a, b, c } = trio();
    const release = syncCrosshair(a.plot, b.plot, c.plot);

    // a's cursor — over mainPane (the data x is inverted from the pixel).
    const y = (a.plot.mainPane.area.top + a.plot.mainPane.area.bottom) / 2;
    a.plot.crosshair({ x: 400, y });

    b.plot.render();
    c.plot.render();
    const ghostsB = fullHeightVerticals(b);
    const ghostsC = fullHeightVerticals(c);
    expect(ghostsB.length).toBeGreaterThan(0);
    expect(ghostsC.length).toBeGreaterThan(0);
    // Same data x → same screen x as the source cursor (all three stages
    // share the same view), so the ghost lands right under pixel 400.
    expect(ghostsB[0][0].x).toBeCloseTo(400, 6);
    expect(ghostsC[0][0].x).toBeCloseTo(400, 6);

    // The originating stage has no ghost of its own — that's the real
    // line's spot (the crosshair plugin).
    a.plot.render();
    expect(fullHeightVerticals(a).length).toBe(0);
    release();
    a.plot.destroy();
    b.plot.destroy();
    c.plot.destroy();
  });

  it("should clear ghosts when the cursor leaves and on release", () => {
    const { a, b } = trio();
    const release = syncCrosshair(a.plot, b.plot);

    const y = (a.plot.mainPane.area.top + a.plot.mainPane.area.bottom) / 2;
    a.plot.crosshair({ x: 400, y });
    b.plot.render();
    expect(fullHeightVerticals(b).length).toBeGreaterThan(0);

    // Move into the margin (above the axis slice) and the pane becomes
    // null — the ghost clears.
    a.plot.crosshair({ x: 400, y: -10 });
    b.plot.render();
    expect(fullHeightVerticals(b).length).toBe(0);

    a.plot.crosshair({ x: 400, y });
    release();
    b.plot.render();
    expect(fullHeightVerticals(b).length).toBe(0);
  });
});
