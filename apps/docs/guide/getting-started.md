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

Give the chart an element to mount into:

```html
<div id="chart"></div>
```

Then:

<<< ../snippets/getting-started.ts{ts}

That is the whole file. The canvas takes its size from `setSize`, so the
container needs no CSS of its own, and `build()` schedules the first frame —
there is no `render()` to call.

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

See [`@finchart/indicators`](https://github.com/finchart/finchart/tree/main/packages/indicators)
for the full indicator list, and the
[`@finchart/dom`](https://github.com/finchart/finchart/tree/main/packages/dom)
README for what `browserDeps` wires up under the hood.

Curious how the pieces fit together? See [Architecture](/guide/architecture).
