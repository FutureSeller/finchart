/**
 * Worker rendering — the main-thread half.
 *
 * This side does three things only: it makes a canvas and hands it to the
 * worker with `transferControlToOffscreen`, it translates pointer input into
 * messages, and with the "jam the main thread" button it deliberately stalls
 * the main thread for 3 seconds — the worker's rAF is none of its business, so
 * bars keep arriving, and that is what this case proves.
 *
 * The chart itself (Plot, data, timers) lives in worker-render.worker.ts —
 * unless the worker can't have it. `startWorkerRender` decides: no worker or
 * no canvas transfer in this browser, a worker module that fails to load, a
 * transfer that throws, a worker that reports it couldn't get a 2D context,
 * or no ready in time — then the same chart is drawn right here, on a new
 * canvas, and the page says why.
 */
import type { OHLC } from "@finchart/core";
import { candleSeries, crosshair, priceFormat, timeTicks } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { fixtureCandles } from "./fixture";
import { startWorkerRender } from "./worker-fallback";
import type { MainToWorker } from "./worker-render.worker";
import { chartHost } from "./stage";

export const title = "Worker rendering";
export const description =
  "The whole chart (Plot, data, rAF) lives in a worker and the main thread only forwards input as messages — drag pan, wheel zoom, and crosshair are synthesized InteractionTarget calls. Stall the main thread with 'Jam main 3s' and the bars keep arriving. The theme isn't CSS here, it's a JS object in the worker (an injected StyleReader). Where a worker can't render — no OffscreenCanvas, a worker that fails to load or reports no 2D context, no ready within 3 seconds — the same chart is drawn on the main thread and the note says why.";

const HEIGHT = 480;

/** The worker's chart, drawn here instead — a transferred canvas can't be drawn on again, so it gets a fresh host. */
function mainThreadChart(host: HTMLElement, width: number): () => void {
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(width, HEIGHT)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);
  plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 4 });
  plot.use(crosshair({ magnet: true }));

  const all = fixtureCandles(900);
  let revealed = 300;
  const price = plot.mainPane.addSeries({ series: candleSeries(), data: all.slice(0, revealed), name: "Price" });
  const timer = window.setInterval(() => {
    const next = all[revealed];
    if (!next) return;
    price.append([next]);
    revealed += 1;
  }, 400);

  return () => {
    window.clearInterval(timer);
    plot.destroy();
  };
}

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "margin-bottom: 8px; display: flex; gap: 8px; align-items: center";
  container.append(toolbar);
  const host = chartHost(container, HEIGHT);

  const width = container.clientWidth || 900;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: ${width}px; height: ${HEIGHT}px; touch-action: none`;
  host.appendChild(canvas);

  const jam = document.createElement("button");
  jam.textContent = "Jam main 3s";
  const note = document.createElement("span");
  toolbar.append(jam, note);

  // Pointer → message. The minimal version of the translation
  // pointerInteractions (@finchart/dom) does on an element — here the
  // destination is a worker instead of an element, and that's the only change.
  let worker: Worker | null = null;
  const send = (message: MainToWorker) => worker?.postMessage(message);
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  let lastPanX: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    lastPanX = event.clientX;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (lastPanX !== null) {
      send({ type: "pan", dx: event.clientX - lastPanX });
      lastPanX = event.clientX;
    }
    const point = local(event);
    send({ type: "crosshair", x: point.x, y: point.y });
  };
  const endPan = () => {
    lastPanX = null;
  };
  const onPointerLeave = () => {
    send({ type: "crosshair", x: -1, y: -1 }); // outside the area — the crosshair hides
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    send({ type: "zoom", factor, x: local(event).x });
  };

  const bridge = (on: boolean) => {
    const toggle = on ? canvas.addEventListener.bind(canvas) : canvas.removeEventListener.bind(canvas);
    toggle("pointerdown", onPointerDown);
    toggle("pointermove", onPointerMove);
    toggle("pointerup", endPan);
    toggle("pointercancel", endPan);
    toggle("pointerleave", onPointerLeave);
    toggle("wheel", onWheel, { passive: false });
  };

  let disposeFallback: (() => void) | null = null;

  const stop = startWorkerRender({
    canvas,
    createWorker: () =>
      new Worker(new URL("./worker-render.worker.ts", import.meta.url), { type: "module" }),
    initMessage: (offscreen): MainToWorker => ({
      type: "init",
      canvas: offscreen,
      width,
      height: HEIGHT,
      dpr: window.devicePixelRatio || 1,
      // The gallery marks dark on <body>, the docs site on <html>.
      dark: document.body.classList.contains("dark") || document.documentElement.classList.contains("dark"),
    }),
    onReady: (ready) => {
      worker = ready;
      bridge(true);
    },
    onFallback: (reason) => {
      worker = null;
      bridge(false);
      // The transferred canvas belongs to a dead worker — take it out and
      // draw on a new one.
      canvas.remove();
      disposeFallback = mainThreadChart(host, width);
      note.textContent = `Drawing on the main thread: ${reason}.`;
    },
  });

  jam.addEventListener("click", () => {
    note.textContent = worker
      ? "Main thread stalled… (the chart keeps running)"
      : "Main thread stalled… (the fallback chart stalls with it)";
    // Block one rendered frame later, so the text shows up first.
    requestAnimationFrame(() => {
      const until = performance.now() + 3000;
      while (performance.now() < until) {
        // busy wait — reproducing a main-thread jam
      }
      note.textContent = worker
        ? "Main stalled for 3 seconds and the bars kept arriving"
        : "Main stalled for 3 seconds — on the main thread, the chart stalled too";
    });
  });

  return () => {
    stop(); // before ready: terminate and stop listening; after ready: timers, rAF and the Plot go with the worker
    bridge(false);
    disposeFallback?.();
    toolbar.remove();
    host.remove();
  };
}
