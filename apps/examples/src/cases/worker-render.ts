/**
 * Worker rendering — the main-thread half.
 *
 * This side does three things only: it makes a canvas and hands it to the
 * worker with `transferControlToOffscreen`, it translates pointer input into
 * messages, and with the "jam the main thread" button it deliberately stalls
 * the main thread for 3 seconds — the worker's rAF is none of its business, so
 * bars keep arriving, and that is what this case proves.
 *
 * The chart itself (Plot, data, timers) all lives in worker-render.worker.ts.
 */
import type { MainToWorker } from "./worker-render.worker";
import { chartHost } from "./stage";

export const title = "Worker rendering";
export const description =
  "The whole chart (Plot, data, rAF) lives in a worker and the main thread only forwards input as messages — drag pan, wheel zoom, and crosshair are synthesized InteractionTarget calls. Stall the main thread with 'Jam main 3s' and the bars keep arriving. The theme isn't CSS here, it's a JS object in the worker (an injected StyleReader).";

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "margin-bottom: 8px; display: flex; gap: 8px; align-items: center";
  container.append(toolbar);
  const host = chartHost(container, 480);

  const width = container.clientWidth || 900;
  const height = 480;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: ${width}px; height: ${height}px; touch-action: none`;
  host.appendChild(canvas);

  const worker = new Worker(
    new URL("./worker-render.worker.ts", import.meta.url),
    { type: "module" },
  );
  const send = (message: MainToWorker, transfer: Transferable[] = []) =>
    worker.postMessage(message, transfer);

  const offscreen = canvas.transferControlToOffscreen();
  send(
    {
      type: "init",
      canvas: offscreen,
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      dark: document.body.classList.contains("dark"),
    },
    [offscreen],
  );

  // Pointer → message. The minimal version of the translation
  // pointerInteractions (@finchart/dom) does on an element — here the
  // destination is a worker instead of an element, and that's the only change.
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

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const jam = document.createElement("button");
  jam.textContent = "Jam main 3s";
  const note = document.createElement("span");
  jam.addEventListener("click", () => {
    note.textContent = "Main thread stalled… (the chart keeps running)";
    // Block one rendered frame later, so the text shows up first.
    requestAnimationFrame(() => {
      const until = performance.now() + 3000;
      while (performance.now() < until) {
        // busy wait — reproducing a main-thread jam
      }
      note.textContent = "Main stalled for 3 seconds and the bars kept arriving";
    });
  });
  toolbar.append(jam, note);

  return () => {
    worker.terminate(); // timers, rAF, and the Plot are all cleared away with the worker
    toolbar.remove();
    host.remove();
  };
}
