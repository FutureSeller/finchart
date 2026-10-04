---
description: "Stand a candlestick chart up in one file, then add volume, a crosshair and real-time updates. The 60-second example, and what each line buys you."
---

# Getting Started

<script setup>
import * as gettingStartedDemo from "../../examples/src/cases/getting-started-demo";
</script>

Get one candlestick chart on screen in 60 seconds.

## Installation

::: code-group

```bash [npm]
npm install @finchart/core @finchart/dom
```

```bash [pnpm]
pnpm add @finchart/core @finchart/dom
```

```bash [yarn]
yarn add @finchart/core @finchart/dom
```

```bash [bun]
bun add @finchart/core @finchart/dom
```

:::

## Quick Start

Give the chart an element to mount into, with a height:

```html
<div id="chart" style="height: 400px"></div>
```

Then:

<<< ../snippets/getting-started.ts{ts}

That is the whole file. The canvas takes its size from `setSize`, but it is
layered over the container rather than laid out in it, so the container's own
CSS decides how much of the page the chart takes — without the height, an
empty `<div>` is 0 px tall and whatever follows it is drawn over. (With
`browserDeps({ autoSize: true })` the chart follows that size instead of
`setSize`.) `build()` schedules the first frame — there is no `render()` to
call.

Here's that same chart, live (resized to fit this page — the code above uses
a fixed 800×400):

<CaseDemo :case="gettingStartedDemo" />

Drag to pan, scroll to zoom.

> Data must be in ascending x order, or you'll get a `DataError`. To find
> out before it throws, `validateSeriesData(data)` answers as a value —
> see [Checking data before it goes in](/guide/plot-contract#checking-data-before-it-goes-in).

## Real-Time Updates & Indicators

::: code-group

```bash [npm]
npm install @finchart/indicators
```

```bash [pnpm]
pnpm add @finchart/indicators
```

```bash [yarn]
yarn add @finchart/indicators
```

```bash [bun]
bun add @finchart/indicators
```

:::

Register the series with `addSeries` instead of the builder to get a handle
back — that handle is what `updateLast` and an indicator's `source` both need:

<<< ../snippets/real-service.ts{ts}

The two `conflated` feeds are for a loud socket: every `updateLast` copies the
array, and a conflated feed coalesces the repeated updates to the same bar
until the next frame instead (a tick that opens a new bar delivers the previous
one at once). The [live feed guide](/guide/live-feed) has the full wiring —
aggregation, snapshots, reconnects and history.

See [`@finchart/indicators`](https://github.com/FutureSeller/finchart/tree/main/packages/indicators)
for the full indicator list, and the
[`@finchart/dom`](https://github.com/FutureSeller/finchart/tree/main/packages/dom)
README for what `browserDeps` wires up under the hood.

Curious how the pieces fit together? See [Architecture](/guide/architecture).
Coming from lightweight-charts? The
[migration table](/guide/migrating-from-lightweight-charts) puts the two side by
side. In a Next.js app, start with [Next.js and React apps](/guide/nextjs); for
the axis's zone and market sessions, [Time zones and sessions](/guide/time-zones).
