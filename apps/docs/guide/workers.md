---
description: "Render a chart in a Web Worker on an OffscreenCanvas: what moves to the worker, how bundlers load it, bridging input, falling back to the main thread, and what live updates cost."
---

# Workers

The core has no DOM, so a whole chart can run in a Web Worker and draw on an
`OffscreenCanvas`. The main thread keeps the canvas element and the input; a
long task on the main thread no longer stalls the chart.
[Worker rendering](/examples/worker-render) is the running version of this
page.

## What goes to the worker

Everything `Plot` needs, wired from `@finchart/core` alone (`@finchart/dom`
needs a document and stays on the main thread):

- **Layers** — a `ChartLayers` over the `OffscreenCanvas`, with `overlay: null`.
  There is no overlay, so no DOM labels, tooltip, legend or divider handles;
  axis labels come from `createCanvasAxisLabels`.
- **Style** — a `StyleReader` over a plain object instead of CSS variables.
  The worker can't read the page's stylesheets, so the theme is sent with the
  first message.
- **Scheduler** — `frameScheduler()` uses the worker's `requestAnimationFrame`
  when it has one, and draws immediately when it doesn't.
- **Data and timers** — the series, the feed and anything that updates them.

## Loading the worker

```ts
const worker = new Worker(new URL("./chart.worker.ts", import.meta.url), { type: "module" });
```

This is the form [Vite](https://vite.dev/guide/features#web-workers) and
[webpack 5](https://webpack.js.org/guides/web-workers/) document: the bundler
finds the `new URL(..., import.meta.url)` and emits the worker as its own
chunk. Other bundlers have their own rules — check theirs before relying on
this line.

## Bridging input

No package bridges input to a worker. `Plot` implements `InteractionTarget`,
so the worker calls those methods when a message arrives, and the main thread
sends the messages from pointer events on the canvas element:

| Main thread | Worker |
|---|---|
| drag by `dx` pixels | `plot.panByPixels(dx)` |
| wheel at `x` | `plot.zoomAtPixel(factor, x)` |
| pointer at `x, y` (or off the chart) | `plot.crosshair({ x, y })` |

Positions are CSS pixels relative to the canvas, the same space the chart
lays out in.

## Falling back

Checking that `Worker` and `transferControlToOffscreen` exist is not enough.
The worker module can fail to load, the transfer or the first message can
throw, and `getContext("2d")` on the `OffscreenCanvas` can return `null`
inside the worker. After a transfer the canvas element can't be drawn on by
the main thread any more. The example handles all of it in one place:

1. Without `Worker` or `transferControlToOffscreen`, build the chart on the
   main thread right away.
2. Otherwise make the worker, listen for `error`, `messageerror` and its
   messages, transfer the canvas and send the first message, all inside one
   `try`.
3. The worker answers `{ type: "ready" }` once the chart stands, or
   `{ type: "failed", reason }` when it can't — a missing 2D context is
   reported this way rather than thrown.
4. On `failed`, `error`, a throw in step 2, or no ready before a timeout,
   terminate the worker, remove the transferred canvas, and build the chart on
   the main thread on a new canvas.
5. If the page goes away first, terminate the worker and stop listening, so a
   late message does nothing.

<<< ../../examples/src/cases/worker-fallback.ts

## What live updates cost

Moving the chart to a worker moves drawing off the main thread. It does not
make ticks free.

- **A tick is a message.** Each `postMessage` from the socket's thread to the
  worker is a structured clone, a queued task and a dispatch, before the chart
  does anything with it.
- **`conflated` in the worker saves deliveries, not messages.** It holds the
  latest bar and calls `updateLast` once per frame, but every tick has already
  crossed as a message by then. To send fewer messages, batch on the sending
  side.
- **Without `requestAnimationFrame` in the worker, `conflated` delivers each
  tick at once.** Its default schedule is `frameScheduler()`, which has no
  frame to wait for there.

The example makes its bars inside the worker on a timer, to show the chart
keeps running while the main thread is stuck. It is not a model for a tick
protocol.
