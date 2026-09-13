/**
 * Starting a worker-rendered chart falls back to the main thread whenever
 * any step fails — no workers, no canvas transfer, a worker that can't be
 * made, a transfer or first message that throws, a worker that errors, says
 * it failed, or never says it's ready. Canvas transfer and real worker
 * rendering are the browser's; what is checked here is the state machine
 * that decides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startWorkerRender, type WorkerRenderStart } from "../worker-fallback";

/** A worker stand-in: records what it's sent and whether it was terminated. */
class FakeWorker extends EventTarget {
  posted: Array<{ message: unknown; transfer: Transferable[] }> = [];
  terminated = 0;
  listeners = 0;
  /** Reports this synchronously from inside `postMessage` — a stand-in may, a real worker never does. */
  answerOnPost: unknown = undefined;
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
    this.listeners += 1;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
    this.listeners -= 1;
    super.removeEventListener(...args);
  }
  throwOnPost = false;
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.throwOnPost) throw new Error("could not clone");
    this.posted.push({ message, transfer });
    if (this.answerOnPost !== undefined) this.say(this.answerOnPost);
  }
  terminate(): void {
    this.terminated += 1;
  }
  say(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  crash(): void {
    this.dispatchEvent(new Event("error"));
  }
}

const offscreen = { kind: "offscreen" };
const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");

function canTransfer(implementation: () => unknown = () => offscreen): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
    configurable: true,
    writable: true,
    value: implementation,
  });
}

function setup(overrides: Partial<WorkerRenderStart> = {}) {
  const worker = new FakeWorker();
  const events: string[] = [];
  const createWorker = vi.fn(() => worker);
  const start: WorkerRenderStart = {
    canvas: document.createElement("canvas"),
    // @ts-expect-error — the stand-in carries only the part of Worker the start uses
    createWorker,
    initMessage: (canvas) => ({ type: "init", canvas }),
    onReady: () => void events.push("ready"),
    onFallback: (reason) => void events.push(`fallback: ${reason}`),
    ...overrides,
  };
  return { worker, events, createWorker, start };
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  canTransfer();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", original);
  else Reflect.deleteProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen");
});

describe("startWorkerRender", () => {
  it("transfers the canvas with the init message and hands over the worker once it says ready", () => {
    const { worker, events, start } = setup();
    startWorkerRender(start);
    expect(worker.posted).toEqual([{ message: { type: "init", canvas: offscreen }, transfer: [offscreen] }]);
    expect(events).toEqual([]);

    worker.say({ type: "ready" });
    worker.say({ type: "ready" });
    expect(events).toEqual(["ready"]);

    // Ready cancels the wait — the timeout no longer falls back.
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["ready"]);
    expect(worker.terminated).toBe(0);
  });

  it("falls back at once without workers or without canvas transfer — and makes no worker", () => {
    vi.stubGlobal("Worker", undefined);
    const first = setup();
    const stop = startWorkerRender(first.start);
    expect(first.events).toEqual(["fallback: this browser can't render a canvas in a worker"]);
    expect(first.createWorker).not.toHaveBeenCalled();
    // The fallback's chart is the caller's — stopping touches nothing.
    stop();
    expect(first.events).toHaveLength(1);

    vi.stubGlobal("Worker", FakeWorker);
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen");
    const second = setup();
    startWorkerRender(second.start);
    expect(second.events).toEqual(["fallback: this browser can't render a canvas in a worker"]);
    expect(second.createWorker).not.toHaveBeenCalled();
  });

  it("falls back when the worker can't be made", () => {
    const { events, start } = setup({
      createWorker: () => {
        throw new Error("blocked by CSP");
      },
    });
    startWorkerRender(start);
    expect(events).toEqual(["fallback: blocked by CSP"]);
  });

  it("falls back and terminates the worker when the transfer or the first message throws", () => {
    canTransfer(() => {
      throw new Error("already transferred");
    });
    const transfer = setup();
    const stop = startWorkerRender(transfer.start);
    expect(transfer.events).toEqual(["fallback: already transferred"]);
    expect(transfer.worker.terminated).toBe(1);
    stop();
    expect(transfer.worker.terminated).toBe(1);

    canTransfer();
    const post = setup();
    post.worker.throwOnPost = true;
    startWorkerRender(post.start);
    expect(post.events).toEqual(["fallback: could not clone"]);
    expect(post.worker.terminated).toBe(1);
  });

  it("falls back and terminates on an error event, a failed message, or no word in time", () => {
    const crashed = setup();
    startWorkerRender(crashed.start);
    crashed.worker.crash();
    expect(crashed.events).toEqual(["fallback: the worker failed to load or crashed"]);
    expect(crashed.worker.terminated).toBe(1);

    const failed = setup();
    startWorkerRender(failed.start);
    failed.worker.say({ type: "failed", reason: "no 2D context on the OffscreenCanvas" });
    expect(failed.events).toEqual(["fallback: no 2D context on the OffscreenCanvas"]);
    expect(failed.worker.terminated).toBe(1);

    const unreadable = setup();
    startWorkerRender(unreadable.start);
    unreadable.worker.dispatchEvent(new Event("messageerror"));
    expect(unreadable.events).toEqual(["fallback: the worker failed to load or crashed"]);
    expect(unreadable.worker.terminated).toBe(1);

    const unexplained = setup();
    startWorkerRender(unexplained.start);
    unexplained.worker.say({ type: "failed" });
    expect(unexplained.events).toEqual(["fallback: the worker reported a failure"]);

    const silent = setup({ timeout: 500 });
    startWorkerRender(silent.start);
    vi.advanceTimersByTime(499);
    expect(silent.events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(silent.events).toEqual(["fallback: the worker did not report ready within 500ms"]);
    expect(silent.worker.terminated).toBe(1);
  });

  it("falls back once — a crash after a failed message, or a late ready, changes nothing", () => {
    const { worker, events, start } = setup();
    startWorkerRender(start);
    worker.say({ type: "failed", reason: "boom" });
    worker.crash();
    worker.say({ type: "ready" });
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["fallback: boom"]);
    expect(worker.terminated).toBe(1);
    expect(worker.listeners).toBe(0);
  });

  it("a worker that crashes after ready still hands the chart to the main thread", () => {
    const { worker, events, start } = setup();
    startWorkerRender(start);
    worker.say({ type: "ready" });
    worker.crash();
    expect(events).toEqual(["ready", "fallback: the worker failed to load or crashed"]);
    expect(worker.terminated).toBe(1);
  });

  it("stopping before ready terminates the worker, and nothing that arrives later is heard", () => {
    const { worker, events, start } = setup();
    const stop = startWorkerRender(start);
    stop();
    expect(worker.terminated).toBe(1);
    expect(worker.listeners).toBe(0);

    worker.say({ type: "ready" });
    worker.say({ type: "failed", reason: "late" });
    worker.crash();
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);

    stop();
    expect(worker.terminated).toBe(1);
  });

  it("a report that arrives while the first message is still being posted counts like any other", () => {
    const failed = setup();
    failed.worker.answerOnPost = { type: "failed", reason: "at once" };
    startWorkerRender(failed.start);
    vi.advanceTimersByTime(60_000);
    expect(failed.events).toEqual(["fallback: at once"]);
    expect(failed.worker.terminated).toBe(1);

    const ready = setup();
    ready.worker.answerOnPost = { type: "ready" };
    startWorkerRender(ready.start);
    vi.advanceTimersByTime(60_000);
    expect(ready.events).toEqual(["ready"]);
    expect(ready.worker.terminated).toBe(0);
  });

  it("ignores messages that are not its own", () => {
    const { worker, events, start } = setup();
    startWorkerRender(start);
    worker.say({ type: "something-else" });
    worker.say(null);
    worker.say("ready");
    expect(events).toEqual([]);
  });
});
