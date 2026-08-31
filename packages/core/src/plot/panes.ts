/**
 * The chart's pane list — who's in it, in what order, and the two doors
 * that change it. The main pane is born here and always survives.
 *
 * What the chart keeps for itself is the *decision* a pane change
 * triggers (refit x? notify state? redraw?) — that arrives through
 * `onChange`. What lives here is everything about the list: creation with
 * the chart's defaults, the subscription per pane, removal that survives
 * an extension removing a neighbor mid-cleanup, and the lookups every
 * frame and every pointer event ask of the list.
 */
import type { DataManagerFactory, Range } from "../data";
import {
  contains,
  ContractError,
  type Point,
} from "../primitives";
import type { Scale } from "../scale";
import { Pane, type PaneApi, type PaneChange } from "./pane";
import { type PaneOptions } from "./pane-options";
import { unionOf } from "./range";
import type { YAxisOptions } from "./types";

export interface PaneStackOptions {
  /** Builds a registration's data manager — the wiring's factory, shared by every pane. */
  createDataManager: DataManagerFactory;
  /** The chart's default y-axis options. A reader, not a value — `applyOptions` changes them. */
  yAxisOptions: () => YAxisOptions | undefined;
  /** Runs once for every pane as it's born, the main pane included — the chart mounts its grid here. */
  onCreate: (pane: Pane) => void;
  /** A pane held here reported a change. Stops the moment the pane is removed. */
  onChange: (change: PaneChange) => void;
}

export class PaneStack {
  private readonly panes: Pane[] = [];
  /**
   * The live list, top to bottom. **Read directly by layout and painting**
   * so no frame copies it; nobody outside the chart ever sees this
   * reference — `Plot.panes` hands out a copy.
   */
  readonly list: readonly Pane[] = this.panes;
  /** Per-pane unsubscribe. Run when a pane is removed or on teardown. */
  private readonly unwatch = new Map<Pane, () => void>();

  constructor(
    mainYScale: Scale,
    private readonly options: PaneStackOptions,
  ) {
    this.create(mainYScale, {});
  }

  /**
   * The default pane that holds series. Always exists — if you never create
   * another pane, every series lands here.
   */
  get main(): Pane {
    return this.panes[0];
  }

  /** Stacks one more pane below. */
  add(yScale: Scale, options: PaneOptions): Pane {
    return this.create(yScale, options);
  }

  private create(yScale: Scale, options: PaneOptions): Pane {
    const pane = new Pane(
      yScale,
      this.options.createDataManager,
      options,
      this.options.yAxisOptions,
      (key) => this.assertStateKeyAvailable(key),
    );
    this.options.onCreate(pane);
    this.panes.push(pane);
    this.unwatch.set(pane, pane.subscribe(this.options.onChange));
    return pane;
  }

  /** State keys are semantic identities, so duplicates would make restoration ambiguous. */
  private assertStateKeyAvailable(key: string): void {
    if (this.panes.some((pane) => pane.stateKey === key)) {
      throw new ContractError(`Duplicate pane stateKey: "${key}"`);
    }
  }

  /**
   * Detaches a pane's extensions and takes it out of the list.
   *
   * Returns whatever the pane's extensions threw while being cleaned up —
   * removal still finishes, because a pane left half-attached would be
   * worse. `null` for a pane this stack doesn't hold.
   */
  remove(pane: PaneApi): unknown[] | null {
    if (pane === this.main) {
      throw new ContractError("mainPane cannot be removed");
    }

    const target = this.panes.find((candidate) => candidate === pane);
    if (!target) return null;

    // Clean up its attached extensions first. Skipping this leaves
    // decorations and input consumers still hanging off a pane whose toolbox
    // has fallen away — nowhere on screen, but still in the list.
    const failures = target.detach();

    /**
     * **The index is looked up only after cleanup finishes.** `detach()`
     * runs someone else's code synchronously (an extension's `dispose`),
     * and that code **can call `remove` again** — MACD removing its own
     * pane is exactly that shape. An index captured before would, once the
     * inner removal has pulled the array up from underneath, **remove the
     * wrong pane.** Measured: in `[main, a, b]`, if b's extension removes
     * a, `splice(2,1)` hits nothing and b stays in the list — its
     * subscription already gone and `detached` true, but layout keeps
     * giving it space and rendering keeps drawing it.
     */
    const index = this.panes.indexOf(target);
    if (index !== -1) this.panes.splice(index, 1);
    this.unwatch.get(target)?.();
    this.unwatch.delete(target);

    return failures;
  }

  /**
   * Detaches every pane for teardown and drops every subscription.
   * Returns what the extensions threw; nothing is skipped because of it.
   *
   * **Walks a copy.** An extension's cleanup can call `remove` (the MACD
   * shape again), and if it did while this iterated the live array, the
   * next pane would be skipped and its extensions never cleaned up.
   */
  detachAll(): unknown[] {
    const failures: unknown[] = [];
    for (const pane of this.panes.slice()) failures.push(...pane.detach());
    for (const dispose of this.unwatch.values()) {
      try {
        dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    this.unwatch.clear();
    return failures;
  }

  /**
   * The pane under a point, or null over padding and gaps.
   *
   * A degenerate area contests nothing. Without this, the moment the cursor
   * touches a collapsed pane's zero-height boundary that pane wins, and a
   * tooltip reads a value from **an invisible pane's scale.** The empty
   * area before the first frame produced a phantom hit at (0,0) the same way.
   */
  at(point: Point): PaneApi | null {
    return (
      this.panes.find(
        ({ area }) =>
          area.right > area.left &&
          area.bottom > area.top &&
          contains(area, point),
      ) ?? null
    );
  }

  /** The pane spanning a screen y — what axis drag asks. The same collapsed-pane rule as `at`. */
  atY(y: number): PaneApi | null {
    return (
      this.panes.find(
        ({ area }) => area.bottom > area.top && y >= area.top && y <= area.bottom,
      ) ?? null
    );
  }

  /**
   * The x range of everything held, as a union across panes. null when
   * every pane is empty — that null itself is the answer "nothing to draw."
   */
  xRange(): Range | null {
    return unionOf(this.panes.map((pane) => pane.xRange()));
  }

  /** Every series' x values, pane by pane — what a bar-index mapping recounts from. */
  xValuesPerSeries(): readonly (readonly number[])[] {
    return this.panes.flatMap((pane) => pane.xValuesPerSeries());
  }
}
