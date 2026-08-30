---
description: "Test a chart without a browser: the headless model, feeding synthetic input through routeInput, and asserting on emitted draw commands instead of pixels."
---

# Testing Charts

If you want to test a canvas chart without screenshot diffing, this is how.
You can assert on a chart with no browser, no canvas, no DOM — with
`createPlotModel` alone.

## Five lines

```ts
import { createPlotModel, lineSeries } from "@finchart/core";

const model = createPlotModel({
  size: { width: 800, height: 600 },
  series: { series: lineSeries(), data },
  config: { showGrid: false },
});

const line = model.commands().find((c) => c.type === "drawLine");
expect(line?.points).toHaveLength(data.length);
```

`model.commands()` is the list of draw commands the last frame emitted —
`drawLine`·`drawText`·`drawShape` are plain-data values, safe to serialize
and compare. The list is identical to the real thing even though no canvas
was ever painted — the path the core takes to build commands doesn't fork
between headless and the browser.

## Command shapes, series by series

To assert "a candle was drawn" you have to know **what** a candle comes out
as — there is no `"drawCandle"` type. Every series is a combination of the
primitives below (source: `packages/core/src/series/__tests__/series.test.ts`
asserts exactly these shapes):

| Series | Command combination |
|---|---|
| `lineSeries` | `drawLine` (split at every gap) + `drawShape` `circle` for point markers |
| `candleSeries` | per bar, `drawLine` (wick) + `drawShape` `rect` (body) |
| `barSeries` | per bar, three `drawLine`s (stem, open tick, close tick) |
| `areaSeries` | `drawShape` (fill polygon) + `drawLine` (top line) |
| `baselineSeries` | `drawShape` fills split above/below the baseline + `drawLine` |
| `histogramSeries` | `drawShape` `rect` per bar |

Count candle bodies with `type === "drawShape" && shape.shape === "rect"`
(the payload field of a shape command is `shape`) — if a volume histogram sits in the same pane, those are rects too,
so split by pane or tell them apart by color.

## There really is no DOM

```ts
const model = createPlotModel({ size: { width: 800, height: 600 } });

expect(model.plot.overlay).toBeNull();
```

You pass no container, no `HTMLElement`. `model.plot` is a **real `Plot`**
carrying the whole state, data, decoration, and plugin API — not something
cut down for headless use. So call `model.plot.pan(10)` and the next frame's
commands actually move.

## Tick labels are commands too

Think about having to render a PNG on the server: labels going missing
by default would be a problem. So labels come out as canvas commands
(`drawText`) too — they don't lean on a font renderer or on DOM labels.

```ts
const texts = model
  .commands()
  .filter((c) => c.type === "drawText")
  .map((c) => c.params.text);

expect(texts.length).toBeGreaterThan(0);
```

## Inject collaborators to get determinism

Leave the measurer (`createTextMeasurer`) out and the axis width is a fixed
fallback — for a test that wants a picture pixel-identical to the browser's,
inject the measurer yourself.

```ts
const model = createPlotModel({
  size,
  series: { series: lineSeries(), data },
  config: { axis: { y: { format: () => "####" } } },
  deps: {
    createTextMeasurer: () => ({
      measure: (text) => ({ width: text.length * 10, height: 10 }),
    }),
  },
});
```

With that in, the axis width follows label length in headless too — the same
wiring rule (which collaborator goes in) applies verbatim to `browserDeps()`
on the browser side.

## Why this works

Every DOM dependency in `Plot` sits behind a collaborator — with no
container, overlay, or canvas context, the implementations that genuinely
require the DOM (canvas renderer, DOM labels, dividers) **throw when they try
to build themselves where there is no DOM**. They don't quietly do
nothing — the failure surfaces immediately as a wiring error.
`createPlotModel` only makes that boundary an official entry point — not a
separate "class for tests" but the same `Plot`, wired to memory layers and a
recording renderer.
