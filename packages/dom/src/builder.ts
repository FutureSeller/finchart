import type {
  BaseDataPoint,
  LineStyle,
  PlotConfig,
  PlotDeps,
  Scope,
  Series,
  ViewportDimensions,
} from "@finchart/core";
import { ContractError, Plot } from "@finchart/core";
import type { BrowserDeps } from "./browser-deps";
import { isElementLike } from "./overlay-element";

export class PlotBuilder<T extends BaseDataPoint> {
  private data: T[] = [];
  /** Sparse on purpose — the core door fills every static default. */
  private config: PlotConfig = {};
  private size: ViewportDimensions = { width: 400, height: 300 };
  private scope?: Scope;

  private constructor(
    private deps: PlotDeps | BrowserDeps,
    private series: Series<T> | undefined,
  ) {}

  /**
   * The data type T is fixed by both deps and series.
   *
   *   PlotBuilder.create(browserDeps(), candleSeries()).setSize(800, 600).build(el)
   *
   * `browserDeps()` is a recipe waiting for a container, so `build(el)` feeds
   * it el to complete the wiring. Pass an already-built `PlotDeps` instead
   * and el never enters the wiring.
   *
   * **Passing `series` here means you don't get a handle back.** If you need
   * live updates (`updateLast`) or an indicator input (`source`), don't pass
   * a series — mount it with `plot.mainPane.addSeries(...)` instead, which
   * does return a handle. This argument is the shortcut for "just show one
   * candlestick series."
   */
  static create<T extends BaseDataPoint>(
    deps: PlotDeps | BrowserDeps,
    series?: Series<T>,
  ): PlotBuilder<T> {
    return new PlotBuilder(deps, series);
  }

  addDataPoint(point: T): this {
    this.data.push(point);
    return this;
  }

  addDataPoints(points: T[]): this {
    this.data.push(...points);
    return this;
  }

  setShowGrid(show: boolean): this {
    this.config.showGrid = show;
    return this;
  }

  /** Both axes. To turn off just one, use setAxis. */
  setShowAxisLabels(show: boolean): this {
    return this.setAxis({ x: { showLabels: show }, y: { showLabels: show } });
  }

  /** x is shared by every pane; y becomes each pane's default. */
  setAxis(axis: PlotConfig["axis"]): this {
    this.config.axis = {
      x: { ...this.config.axis?.x, ...axis?.x },
      y: { ...this.config.axis?.y, ...axis?.y },
    };
    return this;
  }

  /** Turns tick values into display strings (dates, currency, etc.). */
  setFormat(format: {
    x?: (value: number) => string;
    y?: (value: number) => string;
  }): this {
    return this.setAxis({
      x: format.x ? { format: format.x } : undefined,
      y: format.y ? { format: format.y } : undefined,
    });
  }

  setPadding(padding: PlotConfig["padding"]): this {
    this.config.padding = padding;
    return this;
  }

  /** Grid style. Series style is passed when the series is created. */
  setGridStyle(grid: Partial<LineStyle>): this {
    this.config.style = { grid: { ...this.config.style?.grid, ...grid } };
    return this;
  }

  /** Initial size of the layers. Change it later with plot.setViewport(). */
  setSize(width: number, height: number): this {
    this.size = { width, height };
    return this;
  }

  /**
   * A parent lifetime to live under — disposing the scope destroys the
   * chart. The builder-path twin of `PlotOptions.scope`: a page-level scope
   * can own several charts plus their sibling subscriptions (theme
   * observation, sync links, sockets), and one `dispose()` walks out of all
   * of it. Destroying the chart yourself first leaves the parent a no-op.
   */
  setScope(scope: Scope): this {
    this.scope = scope;
    return this;
  }

  /**
   * Builds the chart.
   *
   * Series and data go in as a single registration — the registration owns
   * the data, so there's nowhere else to put it. If you need to swap the
   * data later, use `plot.mainPane.addSeries()` instead of the builder.
   *
   * Why mount happens after building: the constructor can't be generic, so
   * it would lose the point type, but `addSeries` is generic on the method,
   * so `T` carries through intact.
   */
  build(container: HTMLElement): Plot {
    /**
     * Reject here if container isn't a DOM element — a common mistake,
     * since other chart libraries accept a selector string too. Without
     * this guard, the browser wiring throws a TypeError that leaks an
     * internal implementation detail, and wiring that never touches the
     * container lets build succeed silently with nothing on screen — the
     * second outcome is worse.
     *
     * Checked structurally, not with `instanceof` — it has to pass both a
     * real element from an iframe and a fake one from tests (see
     * `isElementLike`). `ContractError` is used here because the caller
     * used the contract wrong; the same rejection in `createDomLayers` is a
     * wiring-site `RenderError` instead.
     */
    if (!isElementLike(container)) {
      throw new ContractError(
        `PlotBuilder.build(container) requires a DOM element (received: ${typeof container}) — ` +
          `pass the result of document.querySelector("#chart"), not a selector string`,
      );
    }

    const deps =
      typeof this.deps === "function" ? this.deps(container) : this.deps;
    const plot = new Plot({
      deps,
      config: this.config,
      size: this.size,
      scope: this.scope,
    });

    if (this.series) {
      plot.mainPane.addSeries({ series: this.series, data: this.data });
    }

    return plot;
  }
}
