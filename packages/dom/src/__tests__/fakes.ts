/**
 * The test environment is node, so there's no DOM. This mimics, at a
 * minimum, only the surface a chart actually touches, so the layer
 * creation → draw → commit path can be verified as-is.
 */
import type {
  Canvas2DContext,
  ChartLayers,
  LayersFactory,
  PlotDeps,
  Point,
} from "@finchart/core";
import { browserDeps, type BrowserDepsOptions } from "../browser-deps";

export interface ContextCall {
  method: string;
  args: unknown[];
}

export interface FakeCanvasContext extends Canvas2DContext {
  calls: ContextCall[];
}

/** Records both method calls and property assignments (needed since line width/color are properties). */
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
    // Clipping. The fake doesn't actually clip — clipping is real canvas's
    // job, and what's under test here is "what did it try to draw." The
    // order in which the boundary was set is preserved.
    save: record("save"),
    restore: record("restore"),
    rect: record("rect"),
    clip: record("clip"),
    /**
     * A minimal implementation that only returns character width.
     * `fontBoundingBox*` is deliberately omitted — a box height still has
     * to come out on a surface without it, so the default fake is left to
     * walk that path. Tests that need metrics build their own.
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

export interface StrokedPath {
  width: number;
  color: string;
  dash: number[];
  points: Point[];
}

/**
 * Only looks at what's still on screen right now.
 *
 * Every commit starts with a clearRect, so whatever comes after the last
 * clearRect is the current frame. Without this trim, traces of a previous
 * render bleed in and let a test pass falsely.
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

/** The current frame's fillRect calls. Used for checking the box drawn behind text. */
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
  /** The cursor currently set. The applied history is kept in `cursorLog`. */
  cursor: string | null;
  /** `setCursor` calls in the exact order they arrived — material for asserting "only when the top one changes." */
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

/** A factory to plug into deps.createLayers. Hands back the layers it created. */
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
 * Feeds a fake container into the `browserDeps` recipe to get the finished
 * wiring — the shell's real wiring (DOM labels, dividers, pointer) runs
 * unchanged on top of the fake element.
 */
export function testBrowserDeps(options: BrowserDepsOptions = {}): PlotDeps {
  return browserDeps(options)(fakeContainer());
}

/** Views it back as a FakeElement so a test can dispatch events on it. */
export function asFake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

/** Mimics only the DOM that axis labels actually touch. */
export interface FakeElement {
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  /**
   * Wired to the attribute — that's how the real thing behaves. If the
   * mock didn't mimic this, `element.tabIndex = 0` would silently create a
   * new property, and a check would never catch the defect of failing to
   * distinguish "no attribute" from "explicit -1."
   */
  tabIndex: number;
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
    removeAttribute(name) {
      delete element.attributes[name];
    },
    hasAttribute(name) {
      return name in element.attributes;
    },
    // `div`'s default is -1, and assignment flows down to the attribute — the same rule as the real thing.
    get tabIndex() {
      const raw = Number.parseInt(element.attributes.tabindex ?? "", 10);
      return Number.isNaN(raw) ? -1 : raw;
    },
    set tabIndex(next: number) {
      element.attributes.tabindex = String(next);
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

  // Events arrive from the document during a drag, so ownerDocument must support listeners too.
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
