/**
 * The worker half — the whole chart lives here. Plot, data, the tick timer,
 * the frame scheduler all belong to the worker, and the main thread does
 * nothing but forward input as messages.
 *
 * The wiring itself is the headless proof:
 * - Layers: ChartLayers wrapping an OffscreenCanvas (overlay is null)
 * - Style: a StyleReader reading a JS theme object — a theme where there is no CSS
 * - Scheduler: frameScheduler() — it probes for and grabs the worker's rAF
 * - Labels: the canvas tick-label path
 * - Input: synthesized InteractionTarget calls (panByPixels, zoomAtPixel, crosshair)
 */
import type { ChartLayers } from "@finchart/core";
import {
  candleSeries,
  createCanvasAxisLabels,
  createCanvasRenderer,
  createCanvasTextMeasurer,
  createPlotDeps,
  crosshair,
  DEFAULT_PADDING,
  frameScheduler,
  Plot,
  priceFormat,
  timeTicks,
} from "@finchart/core";
import { fixtureCandles } from "./fixture";
import type { WorkerReport } from "./worker-fallback";

/** Main → worker. The case (worker-render.ts) imports it type-only. */
export type MainToWorker =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      dpr: number;
      dark: boolean;
    }
  | { type: "pan"; dx: number }
  | { type: "zoom"; factor: number; x: number }
  | { type: "crosshair"; x: number; y: number };

/**
 * The same values as the gallery's dark palette (theme.css) — as a JS object,
 * not CSS. Light is left empty: every leaf falling through to the code default
 * is part of the demonstration too (the three tiers of override > variable >
 * default).
 */
const DARK: Record<string, string> = {
  "--chart-grid": "#1e293b",
  "--chart-label": "#94a3b8",
  "--chart-crosshair": "#475569",
  "--chart-crosshair-badge": "#0f172a",
  "--chart-crosshair-badge-back": "#94a3b8",
  "--chart-candle-up": "#22c55e",
  "--chart-candle-down": "#f87171",
};

/**
 * ChartLayers over an OffscreenCanvas — it follows dom-layers' backing-store
 * discipline exactly: the grid at device resolution, coordinates in CSS
 * pixels, and nothing at all when nothing changed (it is called every frame).
 */
function offscreenLayers(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  dpr: number,
): ChartLayers {
  const context = canvas.getContext("2d");
  // Reported to the main thread by `onmessage` below, which then draws there instead.
  if (!context) throw new Error("no 2D context on the OffscreenCanvas");

  let logical = { width, height };
  let applied = { width: 0, height: 0 };

  const sizeBackingStore = (): void => {
    if (logical.width === applied.width && logical.height === applied.height) {
      return;
    }
    canvas.width = Math.round(logical.width * dpr);
    canvas.height = Math.round(logical.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    applied = { ...logical };
  };

  sizeBackingStore();

  return {
    data: {
      get width() {
        return logical.width;
      },
      get height() {
        return logical.height;
      },
      context,
    },
    overlay: null,
    resize(nextWidth, nextHeight) {
      logical = { width: nextWidth, height: nextHeight };
      sizeBackingStore();
    },
    destroy() {
      // The OffscreenCanvas dies with the worker — there is no DOM to clear away.
    },
  };
}

let plot: Plot | null = null;

function init(message: MainToWorker & { type: "init" }): void {
  const vars = message.dark ? DARK : {};

  const deps = createPlotDeps({
    createLayers: (width, height) =>
      offscreenLayers(message.canvas, width, height, message.dpr),
    createRenderer: createCanvasRenderer,
    createStyleReader: () => (name) => vars[name] ?? "",
    createTextMeasurer: createCanvasTextMeasurer,
    createAxisLabels: createCanvasAxisLabels,
    createScheduler: frameScheduler(),
  });

  plot = new Plot({
    deps,
    config: { padding: DEFAULT_PADDING, showGrid: true },
    size: { width: message.width, height: message.height },
  });
  plot.applyOptions({
    axis: {
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: {
        position: "right",
        format: priceFormat({ compact: true, locale: "en-US" }),
      },
    },
    shiftVisibleRangeOnNewBar: true,
    rightOffset: 4,
  });
  plot.use(crosshair({ magnet: true }));

  const all = fixtureCandles(900);
  let revealed = 300;
  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data: all.slice(0, revealed),
    name: "Price",
  });

  // The tick timer belongs to the worker too — the bars keep arriving even
  // while the main thread is jammed.
  setInterval(() => {
    const next = all[revealed];
    if (!next) return;
    price.append([next]);
    revealed += 1;
  }, 400);
}

const report = (message: WorkerReport): void => postMessage(message);

onmessage = (event: MessageEvent) => {
  const message: MainToWorker = event.data;

  if (message.type === "init") {
    // Anything that stops the chart from standing up here — no 2D context,
    // a throwing first frame — goes back as a report, so the main thread
    // falls back instead of waiting out its timeout.
    try {
      init(message);
      report({ type: "ready" });
    } catch (error) {
      report({ type: "failed", reason: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (!plot) return;

  switch (message.type) {
    case "pan":
      plot.panByPixels(message.dx);
      break;
    case "zoom":
      plot.zoomAtPixel(message.factor, message.x);
      break;
    case "crosshair":
      plot.crosshair({ x: message.x, y: message.y });
      break;
  }
};
