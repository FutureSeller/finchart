/**
 * The test environment is node, so there is no DOM. This fakes, at a
 * minimum, only the surface the chart actually touches, so the layer
 * creation -> draw -> commit path can be verified as-is.
 */
import {
  createCanvasAxisLabels,
  type AxisLabelsFactory,
  type AxisLabelsInput,
} from "../axis";
import type { Point } from "../primitives";
import { createPlotDeps, type PlotDepsOptions } from "../plot/presets";
import { frameScheduler } from "../render";
import type { PlotDeps } from "../plot/types";
import { LinearScale, type Scale } from "../scale";
import {
  createCanvasRenderer,
  createCanvasTextMeasurer,
  noStyle,
  type Canvas2DContext,
  type ChartLayers,
  type LayersFactory,
} from "../render";

export interface ContextCall {
  method: string;
  args: unknown[];
}

export interface FakeCanvasContext extends Canvas2DContext {
  calls: ContextCall[];
}

/** Records both method calls and property assignments (needed because line width and color are properties). */
export function fakeCanvasContext(): FakeCanvasContext {
  const calls: ContextCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const state = {
    lineWidth: 1,
    strokeStyle: "" as string,
    fillStyle: "" as string,
    font: "" as string,
    textAlign: "start" as string,
    textBaseline: "alphabetic" as string,
  };

  const property = <K extends keyof typeof state>(name: K) => ({
    get: () => state[name],
    set: (value: (typeof state)[K]) => {
      state[name] = value;
      calls.push({ method: `set:${name}`, args: [value] });
    },
    enumerable: true,
  });

  const context = {
    calls,
    clearRect: record("clearRect"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    stroke: record("stroke"),
    fill: record("fill"),
    fillRect: record("fillRect"),
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    // Clipping. The fake doesn't actually clip — clipping is the real
    // canvas's job, and what matters here is "what was it trying to draw."
    // The order in which the boundary was applied is preserved.
    save: record("save"),
    restore: record("restore"),
    rect: record("rect"),
    clip: record("clip"),
    /** Gradients are also captured as a recording — the axis is the constructor args, each stop is an addColorStop call. */
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      calls.push({ method: "createLinearGradient", args: [x0, y0, x1, y1] });
      return {
        addColorStop: (offset: number, color: string) => {
          calls.push({ method: "addColorStop", args: [offset, color] });
        },
      };
    },
    /**
     * A minimal implementation that only returns text width.
     * `fontBoundingBox*` is deliberately left out — the box height still
     * has to come out on a surface that lacks it, so the default fake is
     * made to exercise that path.
     */
    measureText: (text: string) => {
      calls.push({ method: "measureText", args: [text] });
      return { width: text.length * 7 } as TextMetrics;
    },
  };

  Object.defineProperties(context, {
    lineWidth: property("lineWidth"),
    strokeStyle: property("strokeStyle"),
    fillStyle: property("fillStyle"),
    font: property("font"),
    textAlign: property("textAlign"),
    textBaseline: property("textBaseline"),
  });

  return context as unknown as FakeCanvasContext;
}

/**
 * Does this accept only values that look like a valid CSS `font` shorthand,
 * the way a real canvas would? Keep exactly one copy of this fixture — with
 * multiple copies, each one ends up with slightly different rules, and you
 * get the accident of rejecting the canonical shape
 * (`"600 12px Inter, sans-serif"`) while letting a broken value through. A
 * fake that disagrees with the real canvas guards nothing.
 *
 * Allows leading tokens (style/variant/weight/stretch), and rejects another
 * number following the size.
 */
export function acceptsFontShorthand(next: unknown): boolean {
  if (typeof next !== "string") return false;
  const tokens = next.trim().split(/\s+/);
  const size = tokens.findIndex((token) =>
    /^[\d.]+(px|pt|em|rem)(\/\S+)?$/.test(token),
  );
  if (size < 0 || size >= tokens.length - 1) return false;
  return !/^[\d.]+$/.test(tokens[size + 1]);
}

/** A minimal font channel that silently ignores an assignment using the rule above. */
export function rejectingFont(initial = "44px Inter"): { font: string } {
  let font = initial;
  return {
    get font(): string {
      return font;
    },
    set font(next: string) {
      if (acceptsFontShorthand(next)) font = next;
    },
  };
}

export interface StrokedPath {
  width: number;
  color: string;
  dash: number[];
  points: Point[];
}

/**
 * Looks only at what is currently left on screen.
 *
 * Every commit starts with a clearRect, so everything after the last
 * clearRect is the current frame. Without this cut, traces of a previous
 * render get mixed in and the test passes falsely.
 */
export function lastFrame(context: FakeCanvasContext): ContextCall[] {
  let start = 0;
  context.calls.forEach((call, index) => {
    if (call.method === "clearRect") start = index;
  });

  return context.calls.slice(start);
}

/** Reconstructs the lines actually stroked in the current frame. */
export function strokedPaths(context: FakeCanvasContext): StrokedPath[] {
  const paths: StrokedPath[] = [];
  let width = 1;
  let color = "";
  let dash: number[] = [];
  let points: Point[] = [];

  for (const { method, args } of lastFrame(context)) {
    switch (method) {
      case "set:lineWidth":
        width = args[0] as number;
        break;
      case "set:strokeStyle":
        color = args[0] as string;
        break;
      case "setLineDash":
        dash = args[0] as number[];
        break;
      case "beginPath":
        points = [];
        break;
      case "moveTo":
      case "lineTo":
        points.push({ x: args[0] as number, y: args[1] as number });
        break;
      case "stroke":
        paths.push({ width, color, dash, points });
        break;
    }
  }

  return paths;
}

export interface FilledCircle {
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

export function filledCircles(context: FakeCanvasContext): FilledCircle[] {
  const circles: FilledCircle[] = [];
  let fill = "";

  for (const { method, args } of lastFrame(context)) {
    if (method === "set:fillStyle") fill = args[0] as string;
    if (method === "arc") {
      circles.push({
        cx: args[0] as number,
        cy: args[1] as number,
        r: args[2] as number,
        fill,
      });
    }
  }

  return circles;
}

export interface DrawnText {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align: string;
  baseline: string;
}

/** Reconstructs the text actually drawn in the current frame. */
export function drawnTexts(context: FakeCanvasContext): DrawnText[] {
  const texts: DrawnText[] = [];
  let font = "";
  let color = "";
  let align = "";
  let baseline = "";

  for (const { method, args } of lastFrame(context)) {
    switch (method) {
      case "set:font":
        font = args[0] as string;
        break;
      case "set:fillStyle":
        color = args[0] as string;
        break;
      case "set:textAlign":
        align = args[0] as string;
        break;
      case "set:textBaseline":
        baseline = args[0] as string;
        break;
      case "fillText":
        texts.push({
          text: args[0] as string,
          x: args[1] as number,
          y: args[2] as number,
          font,
          color,
          align,
          baseline,
        });
        break;
    }
  }

  return texts;
}

export interface FilledRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

/** fillRect calls in the current frame. Used to check the box behind text. */
export function filledRects(context: FakeCanvasContext): FilledRect[] {
  const rects: FilledRect[] = [];
  let fill = "";

  for (const { method, args } of lastFrame(context)) {
    if (method === "set:fillStyle") fill = args[0] as string;
    if (method === "fillRect") {
      rects.push({
        x: args[0] as number,
        y: args[1] as number,
        width: args[2] as number,
        height: args[3] as number,
        fill,
      });
    }
  }

  return rects;
}

export interface FakeLayers extends ChartLayers {
  context: FakeCanvasContext;
  destroyed: boolean;
  /** The cursor currently set. `cursorLog` holds the history of what was applied. */
  cursor: string | null;
  /** In the exact order `setCursor` was called — the material for asserting "only when the topmost one changes." */
  cursorLog: (string | null)[];
}

export function fakeLayers(width = 800, height = 600): FakeLayers {
  const context = fakeCanvasContext();
  const size = { width, height };

  const layers: FakeLayers = {
    context,
    destroyed: false,
    cursor: null,
    cursorLog: [],
    setCursor(cursor) {
      layers.cursor = cursor;
      layers.cursorLog.push(cursor);
    },
    data: {
      get width() {
        return size.width;
      },
      get height() {
        return size.height;
      },
      context,
    },
    overlay: fakeElement() as unknown as HTMLElement,
    resize(nextWidth, nextHeight) {
      size.width = nextWidth;
      size.height = nextHeight;
    },
    destroy() {
      layers.destroyed = true;
    },
  };

  return layers;
}

/** A factory meant to be plugged into deps.createLayers. Returns the layers it created. */
export function fakeLayersFactory(): {
  createLayers: LayersFactory;
  created: FakeLayers[];
} {
  const created: FakeLayers[] = [];

  return {
    created,
    createLayers: (width, height) => {
      const layers = fakeLayers(width, height);
      created.push(layers);
      return layers;
    },
  };
}

export function fakeContainer(): HTMLElement {
  return fakeElement() as unknown as HTMLElement;
}

/**
 * The complete wiring used by stage-behavior tests — assembled from the
 * core alone: canvas axis labels (drawing is captured by the fake
 * context), fake layers, code-fallback styles. Input, resize observation,
 * and size observation are absent by default — a test that checks that
 * wiring adds it explicitly.
 */
export function testBrowserDeps(options: PlotDepsOptions = {}): PlotDeps {
  return createPlotDeps({
    createAxisLabels: createCanvasAxisLabels,
    createScheduler: frameScheduler(),
    ...options,
    createLayers: options.createLayers ?? fakeLayersFactory().createLayers,
    createRenderer: options.createRenderer ?? createCanvasRenderer,
    createStyleReader: options.createStyleReader ?? (() => noStyle),
    createTextMeasurer:
      options.createTextMeasurer ?? createCanvasTextMeasurer,
  });
}

/**
 * `testBrowserDeps` plus the very scales its Plot will be handed. The
 * x viewport in mapping space (bar index, not data x) has no public
 * window, so a test that wants to read or drive it holds the scale
 * itself. **For one Plot** — mount a second from the same `deps` and the
 * two share an axis, which is exactly what the factory contract exists
 * to prevent (see deps-reuse.test).
 */
export function testBrowserDepsWithScales(options: PlotDepsOptions = {}): {
  deps: PlotDeps;
  xScale: Scale;
  yScale: Scale;
} {
  const xScale = new LinearScale();
  const yScale = new LinearScale();
  return {
    deps: testBrowserDeps({
      ...options,
      xScale: () => xScale,
      mainPaneYScale: () => yScale,
    }),
    xScale,
    yScale,
  };
}

/**
 * A spy that captures what the core hands to the label renderer — the
 * standard observation point for tick content and format tests. Asserts on
 * the contract's input (`AxisLabelsInput`), not on a specific
 * implementation.
 */
export function axisLabelsSpy(): {
  createAxisLabels: AxisLabelsFactory;
  /** The last frame's input. Null after a clear or before the first render. */
  lastInput: () => AxisLabelsInput | null;
  /** The last frame's input — throws if there is none (a test bug that never rendered). */
  input: () => AxisLabelsInput;
  xTexts: () => string[];
  yTexts: () => string[];
} {
  const seen: { last: AxisLabelsInput | null } = { last: null };

  const input = (): AxisLabelsInput => {
    if (!seen.last) throw new Error("the label renderer has not received input yet");
    return seen.last;
  };

  return {
    createAxisLabels: () => ({
      render(next) {
        seen.last = next;
      },
      clear() {
        seen.last = null;
      },
      destroy() {
        seen.last = null;
      },
    }),
    lastInput: () => seen.last,
    input,
    xTexts: () => seen.last?.x.map((tick) => tick.label) ?? [],
    yTexts: () => seen.last?.y.map((tick) => tick.label) ?? [],
  };
}

/** Views the element back as a FakeElement so a test can fire events on it. */
export function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

/** Fakes only the DOM that axis labels actually touch. */
export interface FakeElement {
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): FakeElement;
  replaceChildren(...next: FakeElement[]): void;
  remove(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatch(type: string, event: unknown): void;
  getBoundingClientRect(): { left: number; top: number };
  listeners: Map<string, Array<(event: unknown) => void>>;
  ownerDocument: FakeElement & { createElement(tag: string): FakeElement };
}

export function fakeElement(tagName = "div"): FakeElement {
  const listeners = new Map<string, Array<(event: unknown) => void>>();

  const element: FakeElement = {
    tagName,
    textContent: "",
    style: {},
    attributes: {},
    children: [],
    parent: null,
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setAttribute(name, value) {
      element.attributes[name] = value;
    },
    appendChild(child) {
      child.parent = element;
      element.children.push(child);
      return child;
    },
    replaceChildren(...next) {
      for (const child of element.children) child.parent = null;
      element.children = next;
      for (const child of next) child.parent = element;
    },
    remove() {
      if (!element.parent) return;
      element.parent.children = element.parent.children.filter(
        (child) => child !== element,
      );
      element.parent = null;
    },
    ownerDocument: undefined as unknown as FakeElement & {
      createElement(tag: string): FakeElement;
    },
  };

  // Events are received on the document during a drag, so ownerDocument
  // must support listeners too.
  if (tagName !== "#document") {
    const document = fakeElement("#document") as FakeElement & {
      createElement(tag: string): FakeElement;
    };
    document.createElement = (tag: string) => {
      const child = fakeElement(tag);
      child.ownerDocument = document;
      return child;
    };
    element.ownerDocument = document;
  }

  return element;
}

/** Finds the container the label renderer created inside the overlay. */
export function axisLabelRoot(overlay: unknown): FakeElement | undefined {
  return (overlay as FakeElement).children.find(
    (child) => "data-chart-axis" in child.attributes,
  );
}

export function axisLabels(overlay: unknown): FakeElement[] {
  return axisLabelRoot(overlay)?.children ?? [];
}
