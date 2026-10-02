/**
 * An extension installs with one function and uninstalls with one
 * function. Three things to guarantee: use returns the plugin's own
 * object as-is (no wrapping), destroy() cleans up everything it
 * installed, and cleaning up twice is safe.
 */
import { describe, expect, it, vi } from "vitest";
import { ContractError, pluginApi, teardown, type Plugin, type PluginApi } from "../../primitives";
import { lineSeries } from "../../series";
import { crosshair } from "../../extensions/crosshair";
import { paneMaximize } from "../../extensions/pane-maximize";
import type {
  DecorationHost,
  InputHost,
  PaneHost,
  PlotEventSource,
  RenderRequester,
} from "../capabilities";
import type { Plot } from "../plot";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { FakeLayers } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";
import { createPlotModel } from "../model";

const mounted = new WeakMap<Plot, FakeLayers>();

const mount = () => {
  const result = mountPlot({
    deps: testBrowserDeps(),
    series: lineSeries(),
    config: defaultConfig,
  });
  mounted.set(result.plot, result.layers);
  return result.plot;
};

/** Whether the stage actually cleaned up the layers too — the last box on the "did it go all the way" checklist. */
const layersOf = (plot: Plot): FakeLayers => mounted.get(plot)!;

/** The number of plugins the stage is holding — that the list doesn't grow
 * is invisible from the outside, so this is the one place that peeks inside. */
const installedCount = (plot: Plot): number =>
  (plot as unknown as { plugins: readonly PluginApi[] }).plugins.length;

/** A minimal plugin that logs install and dispose. */
function spyPlugin(log: string[], name: string) {
  return (): Plugin<Plot> => () => {
    log.push(`${name}:install`);
    return teardown(() => log.push(`${name}:dispose`));
  };
}

describe("plot.use", () => {
  it("should return the plugin's own object untouched", () => {
    const plot = mount();
    // pluginApi plants a lifecycle in place — it never builds a new object.
    const own = { add: (n: number) => n * 2 };
    const api = pluginApi(own, () => {});

    const returned = plot.use(() => api);

    // Wrapping it before returning would break identity and blur the type.
    expect(returned).toBe(api);
    expect(returned).toBe(own);
    expect(returned.add(21)).toBe(42);
  });

  it("should hand the plot to the plugin", () => {
    const plot = mount();
    let seen: unknown;

    plot.use((host) => {
      seen = host;
      return teardown(() => {});
    });

    expect(seen).toBe(plot);
  });

  it("should accept a plugin that asks for less than the whole plot", () => {
    const plot = mount();
    let asked = 0;

    // Structural typing — a Plot satisfies a plugin that only demands what it needs.
    // This is where the capability interfaces (X6b) grow from.
    const narrow: Plugin<{ requestRender(): void }> = (host) => {
      host.requestRender();
      asked += 1;
      return teardown(() => {});
    };

    plot.use(narrow);

    expect(asked).toBe(1);
  });

  it("should refuse to install on a destroyed plot", () => {
    const plot = mount();
    plot.destroy();

    // Succeeding silently would mean dispose is never called, leaking a resource.
    expect(() => plot.use(() => teardown(() => {}))).toThrow(ContractError);
  });
});

describe("plot.destroy", () => {
  it("should dispose everything it installed", () => {
    const plot = mount();
    const log: string[] = [];

    plot.use(spyPlugin(log, "a")());
    plot.use(spyPlugin(log, "b")());
    log.length = 0;

    plot.destroy();

    expect(log).toEqual(["b:dispose", "a:dispose"]);
  });

  it("should dispose in reverse install order", () => {
    // Something installed later may have been built on top of something earlier.
    const plot = mount();
    const log: string[] = [];

    for (const name of ["first", "second", "third"]) {
      plot.use(spyPlugin(log, name)());
    }
    log.length = 0;

    plot.destroy();

    expect(log).toEqual(["third:dispose", "second:dispose", "first:dispose"]);
  });

  it("should not dispose twice when the caller already did", () => {
    const plot = mount();
    const dispose = vi.fn();

    const api = plot.use(() => teardown(dispose));
    api.dispose();
    plot.destroy();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("should survive a plugin the caller disposed out of order", () => {
    const plot = mount();
    const log: string[] = [];

    plot.use(spyPlugin(log, "kept")());
    const early = plot.use(spyPlugin(log, "early")());
    early.dispose();
    log.length = 0;

    plot.destroy();

    expect(log).toEqual(["kept:dispose"]);
  });
});

describe("teardown", () => {
  it("should run the given function once, however many times it is called", () => {
    const fn = vi.fn();
    const api = teardown(fn);

    api.dispose();
    api.dispose();
    api.dispose();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should report disposal", () => {
    const api = teardown(() => {});

    expect(api.disposed).toBe(false);
    api.dispose();
    expect(api.disposed).toBe(true);
  });
});

describe("pluginApi", () => {
  it("should refuse an object that already has dispose", () => {
    // `pluginApi(teardown(fn), { … })` is a common misuse of the spread
    // pattern, and letting it through would mean **the first disposer
    // gets silently discarded.**
    const first = vi.fn();

    expect(() => pluginApi(teardown(first), () => {})).toThrow(ContractError);
    expect(first).not.toHaveBeenCalled();
  });

  it("should refuse a frozen object", () => {
    expect(() => pluginApi(Object.freeze({ node: 1 }), () => {})).toThrow(
      ContractError,
    );
  });

  it("should not let dispose be swapped out from under disposed", () => {
    // Swapping it out would remove the code that flips `done`, leaving disposed permanently false.
    const api = teardown(() => {});

    expect(() => {
      (api as { dispose: () => void }).dispose = () => {};
    }).toThrow(TypeError);
  });

  it("should still allow spying and decoration", () => {
    // The point isn't to lock it down — redefinition must stay open.
    const api = teardown(() => {});
    const spy = vi.spyOn(api, "dispose");

    api.dispose();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should keep disposed live on an api with its own methods", () => {
    // Merging via spread (`{ ...teardown(fn), add }`) copies the accessor's
    // value at that instant, leaving disposed permanently false. This
    // helper exists to close off that trap.
    const api = pluginApi({ add: (n: number) => n + 1 }, () => {});

    expect(api.disposed).toBe(false);
    api.dispose();
    expect(api.disposed).toBe(true);
    expect(api.add(1)).toBe(2);
  });
});

/**
 * The stage releases dead plugins — it used to only remove them in
 * destroy(), so a React effect that rebuilds on every option change kept
 * piling up dead APIs.
 */
describe("releasing dead plugins", () => {
  it("should not grow when install and dispose alternate", () => {
    const plot = mount();
    const seen: PluginApi[] = [];

    for (let i = 0; i < 500; i++) {
      const api = plot.use(() => teardown(() => {}));
      seen.push(api);
      api.dispose();
    }

    // The last one hasn't been swept yet — sweeping happens at install time.
    expect(installedCount(plot)).toBeLessThanOrEqual(1);
    // But every one of them was actually cleaned up.
    expect(seen.every((api) => api.disposed)).toBe(true);
  });

  it("should keep the live ones", () => {
    const plot = mount();

    const kept = plot.use(() => teardown(() => {}));
    plot.use(() => teardown(() => {})).dispose();
    plot.use(() => teardown(() => {}));

    expect(installedCount(plot)).toBe(2);
    expect(kept.disposed).toBe(false);
  });
});

/** Cleanup runs to completion — one plugin's dispose throwing used to skip
 * the rest of teardown (releasing the observer, layers.destroy), leaking resources. */
describe("failure during cleanup", () => {
  it("should finish destroying even when a plugin throws", () => {
    const plot = mount();
    const later = vi.fn();

    plot.use(() => teardown(later)); // installed first = cleaned up last
    plot.use(() =>
      teardown(() => {
        throw new Error("boom");
      }),
    );

    expect(() => plot.destroy()).toThrow("boom");
    // Everything after the throw still ran.
    expect(later).toHaveBeenCalledTimes(1);
    expect(layersOf(plot).destroyed).toBe(true);
  });

  it("should report every failure when several throw", () => {
    const plot = mount();
    for (const name of ["a", "b"]) {
      plot.use(() =>
        teardown(() => {
          throw new Error(name);
        }),
      );
    }

    expect(() => plot.destroy()).toThrow(AggregateError);
    expect(layersOf(plot).destroyed).toBe(true);
  });

  it("should not notify while tearing down", () => {
    // If a plugin removes the pane it created, panesChange fires — but
    // that's not a change the user made, it's the stage's dying breath.
    const plot = mount();
    const seen: string[] = [];

    plot.use((host) => {
      const pane = host.addPane();
      return teardown(() => host.removePane(pane));
    });
    plot.on("panesChange", () => seen.push("panesChange"));

    plot.destroy();

    expect(seen).toEqual([]);
  });
});

/** One extension throwing must not stop another extension listening to the same event from being called. */
describe("subscriber isolation", () => {
  it("should call every listener even when one throws", () => {
    const plot = mount();
    const second = vi.fn();

    plot.on("render", () => {
      throw new Error("listener boom");
    });
    plot.on("render", second);

    expect(() => plot.render()).toThrow("listener boom");
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("crosshair as a plugin", () => {
  it("should be cleaned up by destroy without an explicit detach", () => {
    // This is the reason X6a exists — previously, forgetting to call the disposer left the subscription in place.
    const plot = mount();
    const cursor = plot.use(crosshair());
    const dispose = vi.spyOn(cursor, "dispose");

    plot.destroy();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("should be safe to detach by hand and then destroy", () => {
    const plot = mount();
    const cursor = plot.use(crosshair());

    cursor.dispose();

    expect(() => plot.destroy()).not.toThrow();
  });
});

/**
 * An extension only demands the capabilities it uses — never the whole
 * Plot. Two things to guarantee: a narrowly-typed plugin still fits into
 * use as-is, and that requirement is actually narrow enough to run on a
 * minimal host that isn't a Plot.
 */
describe("demanding only capabilities", () => {
  it("should accept a plugin that asks for one capability", () => {
    const plot = mount();
    const seen: string[] = [];

    const tiny: Plugin<RenderRequester> = (host) => {
      host.requestRender();
      seen.push("ran");
      return teardown(() => seen.push("gone"));
    };

    const api = plot.use(tiny);
    expect(seen).toEqual(["ran"]);

    api.dispose();
    expect(seen).toEqual(["ran", "gone"]);
  });

  it("should run that plugin on a host that is not a Plot", () => {
    const calls: string[] = [];
    /** Not a Plot — a fake with exactly one capability. */
    const host: RenderRequester = {
      requestRender: () => calls.push("render"),
    };

    const tiny: Plugin<RenderRequester> = (h) => {
      h.requestRender();
      return teardown(() => undefined);
    };
    tiny(host);

    expect(calls).toEqual(["render"]);
  });

  /** Whether the core's own built-in extensions are actually declared narrowly. */
  it("should keep the built-in plugins narrow", () => {
    const plot = mount();

    // The crosshair demands only decoration, render-request, and events —
    // this line itself is the compile-time assertion.
    const narrow: Plugin<
      DecorationHost & RenderRequester & PlotEventSource
    > = crosshair();

    expect(() => plot.use(narrow).dispose()).not.toThrow();
  });

  it("should keep paneMaximize narrow — PaneHost & PlotEventSource & InputHost only", () => {
    const plot = mount();

    // This assignment proves narrowness every time — widening it breaks the compile.
    const narrow: Plugin<PaneHost & PlotEventSource & InputHost> = paneMaximize();

    expect(() => plot.use(narrow).dispose()).not.toThrow();
  });
});

describe("installation during disposal", () => {
  const size = { width: 400, height: 300 };

  it("disposes an API returned after its plot or pane is destroyed during installation", () => {
    const { plot } = createPlotModel({ size });
    const pane = plot.addPane();
    const paneCleanup = vi.fn();
    const paneApi = pane.use(() => {
      plot.removePane(pane);
      return pluginApi({}, paneCleanup);
    });
    expect(paneApi.disposed).toBe(true);
    const cleanup = vi.fn();
    const api = plot.use(host => {
      host.destroy();
      return pluginApi({}, cleanup);
    });
    plot.destroy();
    expect(api.disposed).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(paneCleanup).toHaveBeenCalledTimes(1);
  });
});
