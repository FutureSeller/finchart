/**
 * A frame draws the scene as it stood when the frame began. Someone else's
 * code runs in the middle of a frame — a decoration's `draw`, an axis
 * `format`, a custom series — and it may remove a pane, unmount a
 * decoration or dispose a series. That change shows on the next frame; this
 * one must neither pair what's left with the wrong pane, skip a neighbour,
 * nor throw.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { manualScheduler, type CanvasRenderer } from "../../render";
import type { Series } from "../../series";
import { axisLabelsSpy, testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];

/** A series that claims a fixed value range and counts its draws. */
function fixedSeries(min: number, max: number, onDraw: () => void = () => undefined): Series<LineDataPoint> & { draws: number } {
  const series = {
    draws: 0,
    valueExtent: () => ({ min, max }),
    draw(_renderer: CanvasRenderer) {
      series.draws += 1;
      onDraw();
    },
  };
  return series;
}

function mount() {
  const labels = axisLabelsSpy();
  const deps = testBrowserDeps({ createAxisLabels: labels.createAxisLabels });
  const { plot } = mountPlot({ deps, series: fixedSeries(0, 100), data, config: defaultConfig });
  return { plot, labels };
}

describe("a frame keeps the scene it started with", () => {
  it("draws each pane with its own ticks when a decoration removes a pane before it", () => {
    const { plot } = mount();
    const a = plot.addPane();
    a.addSeries({ series: fixedSeries(1000, 2000), data });
    const b = plot.addPane();
    b.addSeries({ series: fixedSeries(0, 1), data });
    const seen: string[][] = [];
    b.addDecoration({ draw: (_renderer, context) => void seen.push(context.ticks.y.map((tick) => tick.label)) });
    plot.render();
    const own = seen.at(-1);
    const from = seen.length;

    let armed = true;
    plot.addDecoration({ draw: () => {
      if (!armed) return;
      armed = false;
      plot.removePane(a);
    } }, { zIndex: -5000 });
    plot.render();

    // Every frame from here on — the one the removal happened in included.
    const after = seen.slice(from);
    expect(after.length).toBeGreaterThan(0);
    for (const labels of after) expect(labels).toEqual(own);
  });

  it("lays the frame out when an axis format removes a pane mid-layout", () => {
    const { plot } = mount();
    const a = plot.addPane();
    a.addSeries({ series: fixedSeries(0, 100), data });
    const b = plot.addPane();
    b.addSeries({ series: fixedSeries(0, 100), data });
    plot.render();

    let armed = true;
    a.applyOptions({ axis: { format: (value: number) => {
      if (armed) {
        armed = false;
        plot.removePane(b);
      }
      return String(value);
    } } });

    expect(() => plot.render()).not.toThrow();
    expect(plot.panes).toEqual([plot.mainPane, a]);
  });

  it("still draws the next decoration when one unmounts itself and the one before it", () => {
    const { plot } = mount();
    const drawn: string[] = [];
    const offX = plot.addDecoration({ draw: () => void drawn.push("X") });
    let offY: () => void = () => undefined;
    let armed = false;
    offY = plot.addDecoration({ draw: () => {
      drawn.push("Y");
      if (!armed) return;
      armed = false;
      offX();
      offY();
    } });
    plot.addDecoration({ draw: () => void drawn.push("Z") });
    plot.render();

    drawn.length = 0;
    armed = true;
    plot.render();

    expect(drawn).toEqual(["X", "Y", "Z"]);
  });

  it("draws a decoration added mid-frame on the next frame, not this one", () => {
    // Frames only when the test draws one — the add's own request must not
    // draw it before the test looks.
    const deps = testBrowserDeps({ createScheduler: manualScheduler() });
    const { plot } = mountPlot({ deps, series: fixedSeries(0, 100), data, config: defaultConfig });
    const drawn: string[] = [];
    let armed = true;
    plot.addDecoration({ draw: () => {
      drawn.push("first");
      if (!armed) return;
      armed = false;
      plot.addDecoration({ draw: () => void drawn.push("late") });
    } });

    plot.render();
    expect(drawn).toEqual(["first"]);
    drawn.length = 0;
    plot.render();
    expect(drawn).toEqual(["first", "late"]);
    plot.destroy();
  });

  it("still collects the next pane decoration's badge when one unmounts itself", () => {
    const { plot, labels } = mount();
    let offOne: () => void = () => undefined;
    let armed = false;
    offOne = plot.mainPane.addDecoration({
      draw: () => undefined,
      axisBadges: () => {
        if (armed) {
          armed = false;
          offOne();
        }
        return [{ axis: "y", position: 10, label: "one", back: "#000", color: "#fff" }];
      },
    });
    plot.mainPane.addDecoration({
      draw: () => undefined,
      axisBadges: () => [{ axis: "y", position: 20, label: "two", back: "#000", color: "#fff" }],
    });

    armed = true;
    plot.render();

    expect(labels.input().badges.map((badge) => badge.label)).toEqual(["one", "two"]);
  });

  it("still draws the next series when one disposes itself mid-draw", () => {
    const { plot } = mount();
    const pane = plot.addPane();
    let armed = false;
    const first = fixedSeries(0, 100, () => {
      if (!armed) return;
      armed = false;
      handle.dispose();
    });
    const second = fixedSeries(0, 100);
    const handle = pane.addSeries({ series: first, data });
    pane.addSeries({ series: second, data });
    plot.render();
    const before = second.draws;

    armed = true;
    plot.render();

    expect(second.draws - before).toBe(1);
  });
});
