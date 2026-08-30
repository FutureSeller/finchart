/**
 * An extension lives and dies with whatever it's attached to. A pane-level
 * extension used to follow the plot.use(x({ pane })) convention, so
 * removing the pane left the extension alive, still holding its
 * decoration and input consumer onto a pane no longer on screen.
 */
import { describe, expect, it, vi } from "vitest";
import { lineSeries } from "../../series";
import { ContractError } from "../../primitives";
import { teardown, type Plugin } from "../plugin";
import type {
  DataProbe,
  PaneDecorationHost,
  SeriesHost,
  ValueCoordinates,
} from "../capabilities";
import type { PaneApi } from "../pane";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const mount = () =>
  mountPlot({
    deps: testBrowserDeps(),
    series: lineSeries(),
    config: defaultConfig,
    data: [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ],
  }).plot;

describe("pane.use", () => {
  it("should hand the pane to the plugin and return its api untouched", () => {
    const plot = mount();
    let seen: unknown;
    const api = teardown(() => {});

    const returned = plot.mainPane.use((pane) => {
      seen = pane;
      return api;
    });

    expect(seen).toBe(plot.mainPane);
    expect(returned).toBe(api);
  });

  it("should dispose the plugins of a pane that is removed", () => {
    const plot = mount();
    const gone = vi.fn();
    const pane = plot.addPane();

    const api = pane.use(() => teardown(gone));
    expect(api.disposed).toBe(false);

    plot.removePane(pane);

    expect(gone).toHaveBeenCalledTimes(1);
    expect(api.disposed).toBe(true);
  });

  it("should leave other panes alone", () => {
    const plot = mount();
    const kept = plot.mainPane.use(() => teardown(() => {}));
    const doomed = plot.addPane();
    doomed.use(() => teardown(() => {}));

    plot.removePane(doomed);

    expect(kept.disposed).toBe(false);
  });

  it("should dispose pane plugins on destroy too", () => {
    const plot = mount();
    const api = plot.mainPane.use(() => teardown(() => {}));

    plot.destroy();

    expect(api.disposed).toBe(true);
  });

  it("should finish removing the pane even when a plugin throws", () => {
    const plot = mount();
    const pane = plot.addPane();
    pane.use(() =>
      teardown(() => {
        throw new Error("boom");
      }),
    );

    expect(() => plot.removePane(pane)).toThrow("boom");
    // The pane is still removed — half-attached because of one extension would be worse.
    expect(plot.panes).toHaveLength(1);
  });

  it("should refuse to install on a pane that was removed", () => {
    const plot = mount();
    const pane = plot.addPane();
    plot.removePane(pane);

    // Succeeding silently would create an extension the stage doesn't know about — not even destroy could clean it up.
    expect(() => pane.use(() => teardown(() => {}))).toThrow(ContractError);
  });

  it("should refuse to install on a pane whose plot was destroyed", () => {
    const plot = mount();
    const pane = plot.mainPane;
    plot.destroy();

    expect(() => pane.use(() => teardown(() => {}))).toThrow(ContractError);
  });

  it("should dispose a plugin installed during another plugin's teardown", () => {
    const plot = mount();
    const pane = plot.addPane();
    const late = vi.fn();

    pane.use(() => teardown(() => pane.use(() => teardown(late))));

    // Iterating by index would skip something added mid-cleanup — that one would never get cleaned up.
    // (Installation itself is blocked: the pane is already removed, so it throws.)
    expect(() => plot.removePane(pane)).toThrow(ContractError);
    expect(late).not.toHaveBeenCalled();
  });

  it("should not skip a pane when one plugin removes another pane", () => {
    const plot = mount();
    const seen: string[] = [];
    const panes = ["a", "b", "c"].map((name) => {
      const pane = plot.addPane();
      return { name, pane };
    });

    for (const { name, pane } of panes) {
      pane.use(() =>
        teardown(() => {
          seen.push(name);
          // b's cleanup removes a — the underlying array shrinks out from under the loop.
          if (name === "b") plot.removePane(panes[0].pane);
        }),
      );
    }

    plot.destroy();

    // Iterating over the raw list would drop c entirely.
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("should let go of disposed plugins", () => {
    const plot = mount();
    const inspect = plot.mainPane as unknown as { plugins: readonly unknown[] };

    for (let i = 0; i < 100; i++) {
      plot.mainPane.use(() => teardown(() => {})).dispose();
    }

    expect(inspect.plugins.length).toBeLessThanOrEqual(1);
  });
});

/** Pane-side capabilities are declared additively too — a narrowly-typed plugin must actually be narrow enough to run on a minimal fake that isn't a Pane. */
describe("demanding only pane capabilities", () => {
  it("should accept a plugin that only asks to add a series", () => {
    const plot = mount();
    const narrow: Plugin<SeriesHost> = (host) => {
      const handle = host.addSeries({ series: lineSeries(), data: [] });
      return teardown(() => handle.dispose());
    };

    expect(() => plot.mainPane.use(narrow).dispose()).not.toThrow();
  });

  it("should run a decoration plugin on a host that is not a Pane", () => {
    const added: string[] = [];
    const host: PaneDecorationHost = {
      addDecoration: () => {
        added.push("added");
        return () => added.push("removed");
      },
    };

    const narrow: Plugin<PaneDecorationHost> = (h) => {
      const remove = h.addDecoration({ draw: () => {} });
      return teardown(remove);
    };
    narrow(host).dispose();

    expect(added).toEqual(["added", "removed"]);
  });

  it("should convert between value and pixel without the scale", () => {
    const plot = mount();
    // ValueCoordinates does not expose yScale — it can't push the value axis via setDomain.
    const coordinates: ValueCoordinates = plot.mainPane;
    plot.render();

    const middle = (coordinates.area.top + coordinates.area.bottom) / 2;

    expect(coordinates.pixelAtValue(coordinates.valueAt(middle))).toBeCloseTo(
      middle,
      6,
    );
  });

  it("should answer probes through the narrow face", () => {
    const plot = mount();
    const probe: DataProbe = plot.mainPane;

    expect(probe.xRange()).toEqual({ min: 1, max: 2 });
    expect(probe.probe(2)[0].value).toBe(20);
  });
});

/** The stage owns x, and the pane owns the value — coordinate capabilities split the same way. */
describe("coordinate capabilities", () => {
  it("should round-trip data x through pixels", () => {
    const plot = mount();
    plot.render();

    expect(plot.xAt(plot.pixelAtX(1.5))).toBeCloseTo(1.5, 6);
  });

  it("should not hand out the mapping itself", () => {
    const plot = mount();
    // If rebuild leaked out, an extension could recount the bar index itself.
    expect("rebuild" in plot).toBe(false);
  });
});

/** The pane option now demands a type a consumer can actually get their hands on. */
describe("the legend's pane option", () => {
  it("should accept a pane taken from the plot", () => {
    const plot = mount();
    const second: PaneApi = plot.addPane();
    // This line is the compile-time assertion — there used to be no value that could go here.
    const asLegendPane: ValueCoordinates & DataProbe = second;

    expect(asLegendPane.xRange()).toBeNull();
  });
});
