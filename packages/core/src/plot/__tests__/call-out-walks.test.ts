/**
 * Loops that hand control to someone else's code mid-walk — a custom
 * series' `valueExtent`, a focus claimant's `areaOf`, a source's `read` —
 * walk the list as it stood and skip what left, so a removal never makes the
 * next entry go unasked.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series } from "../../series";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];

function extentSeries(extent: () => { min: number; max: number }): Series<LineDataPoint> {
  return {
    valueExtent: () => extent(),
    draw(_renderer: CanvasRenderer) {},
  };
}

describe("walks that call out skip what left, never what's next", () => {
  it("still fits the next pane's value axis when a series' valueExtent removes its own pane", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config: defaultConfig });
    let armed = false;
    const a = plot.addPane();
    a.addSeries({ series: extentSeries(() => {
      if (armed) {
        armed = false;
        plot.removePane(a);
      }
      return { min: 0, max: 100 };
    }), data });
    let top = 100;
    const b = plot.addPane();
    b.addSeries({ series: extentSeries(() => ({ min: 0, max: top })), data });
    plot.render();

    top = 5000;
    armed = true;
    plot.render();

    expect(b.yScale.getDomain()[1]).toBeGreaterThanOrEqual(5000);
  });

  it("still asks the next claimant when one releases itself from inside its areaOf", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config: defaultConfig });
    plot.render();
    const asking = plot.claimFocusArea(() => null);
    let armed = true;
    const leaving = plot.claimFocusArea(() => {
      if (armed) {
        armed = false;
        leaving.release();
      }
      return null;
    });
    plot.claimFocusArea(() => ({ left: 0, top: 0, right: 1000, bottom: 1000 }));

    expect(asking.contestedAt({ x: 10, y: 10 })).toBe(true);
  });

  it("still counts the next series' x range when a source read disposes its own series", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config: defaultConfig });
    const pane = plot.addPane();
    let armed = false;
    const leaving = pane.addSeries({ series: lineSeries(), input: { read: () => {
      if (armed) {
        armed = false;
        leaving.dispose();
      }
      return data;
    } } });
    pane.addSeries({ series: lineSeries(), data: [{ x: 500, y: 1 }, { x: 900, y: 2 }] });

    armed = true;
    // The series that left was already asked — it counts this once; the one
    // after it must not be skipped.
    expect(pane.xRange()).toEqual({ min: 0, max: 900 });
    expect(pane.xRange()).toEqual({ min: 500, max: 900 });
  });
});
