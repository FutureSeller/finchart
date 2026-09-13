---
description: "Worker rendering: the whole chart runs in a Web Worker on an OffscreenCanvas, and falls back to the main thread when the browser or the worker can't."
---

# Worker rendering

<script setup>
import * as mod from "../../examples/src/cases/worker-render";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

The worker builds the chart from the core alone: layers over an
`OffscreenCanvas` with no overlay, a `StyleReader` over a JS object, canvas
tick labels, and `frameScheduler()`. The main thread keeps only the canvas
element and turns pointer events into `panByPixels`, `zoomAtPixel` and
`crosshair` messages.

Starting it is `startWorkerRender`, and every way it can fail ends the same
way: the worker is terminated, the transferred canvas is removed, and the
chart is built on the main thread on a new canvas. The failures it catches are
no `Worker` or no `transferControlToOffscreen`, a worker that can't be made or
fails to load, a transfer or first message that throws, a worker that reports
`failed` (it couldn't get a 2D context), an error after ready, and no ready
within three seconds. [Workers](/guide/workers) explains the pieces.

The bars are made inside the worker on a timer, to show the chart keeps
running while the main thread is stuck. That is not a tick protocol — a real
feed's messages and what they cost are in the guide.

## Source

`apps/examples/src/cases/worker-render.ts` — the main-thread half.

<<< ../../examples/src/cases/worker-render.ts

`apps/examples/src/cases/worker-render.worker.ts` — the worker.

<<< ../../examples/src/cases/worker-render.worker.ts

`apps/examples/src/cases/worker-fallback.ts` — the start and its fallback, tested in `__tests__/worker-fallback.test.ts`.

<<< ../../examples/src/cases/worker-fallback.ts
