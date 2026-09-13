/**
 * Starting a chart that renders in a worker, with a way back.
 *
 * Checking that `Worker` and `transferControlToOffscreen` exist is not
 * enough: the worker module can fail to load (a CSP, a bundler that didn't
 * emit it), the transfer or the first message can throw, and the worker's
 * own `getContext("2d")` can come back null. Every one of those ends here,
 * in one place: the worker is terminated and `onFallback` draws the chart
 * on the main thread. A canvas whose control was transferred can't be drawn
 * on again, so the fallback needs a new one.
 */

/** Worker → main: the handshake this start waits for. */
export type WorkerReport = { type: "ready" } | { type: "failed"; reason: string };

export interface WorkerRenderStart {
  /** The canvas to hand to the worker. After a transfer it belongs to the worker for good. */
  canvas: HTMLCanvasElement;
  /** Makes the worker — `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`. */
  createWorker(): Worker;
  /** The first message, carrying the transferred canvas; the canvas goes in its transfer list. */
  initMessage(canvas: OffscreenCanvas): unknown;
  /** The worker reported ready — the chart runs there from now on. */
  onReady(worker: Worker): void;
  /**
   * Something failed, before or after ready: the worker is already
   * terminated. Draw the chart on the main thread, on a new canvas. Called
   * at most once.
   */
  onFallback(reason: string): void;
  /** How long to wait for the worker's ready (ms). Default 3000. */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 3000;

/** The report a message carries, or null for a message that isn't one. A failure without a reason is still a failure. */
function reportOf(data: unknown): WorkerReport | null {
  if (typeof data !== "object" || data === null) return null;
  const type = Reflect.get(data, "type");
  if (type === "ready") return { type };
  if (type !== "failed") return null;
  const reason = Reflect.get(data, "reason");
  return { type, reason: typeof reason === "string" ? reason : "the worker reported a failure" };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Starts the worker and returns a stop function: before ready it terminates
 * the worker and nothing that arrives later is heard; after a fallback it
 * does nothing (the fallback's chart is the caller's to dispose).
 */
export function startWorkerRender(start: WorkerRenderStart): () => void {
  const supported =
    typeof Worker === "function" && "transferControlToOffscreen" in HTMLCanvasElement.prototype;
  if (!supported) {
    start.onFallback("this browser can't render a canvas in a worker");
    return () => undefined;
  }

  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Where the start is. A stand-in worker can answer from inside
   * `postMessage`, before the wait begins, so a report is judged by this
   * rather than by whether the timer exists yet.
   */
  let phase: "starting" | "waiting" | "ready" | "over" = "starting";

  /** Takes the worker down and stops listening — shared by a failure and a stop. */
  const release = (): void => {
    phase = "over";
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (worker) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onError);
      worker.terminate();
    }
    worker = null;
  };

  // At most once: `release` removes the listeners and the timer first, and
  // no timer is started once the start is over.
  const fail = (reason: string): void => {
    release();
    start.onFallback(reason);
  };

  function onMessage(event: MessageEvent): void {
    const report = reportOf(event.data);
    if (report === null) return;
    if (report.type === "failed") {
      fail(report.reason);
      return;
    }
    if (phase === "ready" || phase === "over" || !worker) return;
    phase = "ready";
    if (timer !== null) clearTimeout(timer);
    timer = null;
    start.onReady(worker);
  }

  function onError(): void {
    fail("the worker failed to load or crashed");
  }

  try {
    worker = start.createWorker();
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onError);
    const offscreen = start.canvas.transferControlToOffscreen();
    worker.postMessage(start.initMessage(offscreen), [offscreen]);
  } catch (error) {
    fail(message(error));
    return () => undefined;
  }

  // Waited for only if no report came back while posting.
  if (phase === "starting") {
    phase = "waiting";
    const timeout = start.timeout ?? DEFAULT_TIMEOUT;
    timer = setTimeout(() => fail(`the worker did not report ready within ${timeout}ms`), timeout);
  }

  return release;
}
