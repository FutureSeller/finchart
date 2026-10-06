---
description: "An integrated React trading screen with live synthetic candles, indicators, drawing tools, and synchronized chart panels."
aside: false
sidebar: false
---

# React trading showcase

An integrated trading screen built with `@finchart/react`. Run the showcase below,
or open it in a new tab for more room. Prices and live updates are synthetic;
no market-data credentials are required.

On narrow screens, open **Settings** for chart controls and drawing tools.
The chart fills the available screen height; multiple panels stack and scroll
within the chart area. Open the demo in a new tab to use the full screen.
The initial view and timeframe changes show recent candles at roughly 8px
spacing. **Fit all** shows the full retained history.

<script setup>
import ShowcaseDemo from "./.vitepress/theme/ShowcaseDemo.vue";
</script>

<ShowcaseDemo src="/demos/react-showcase/index.html" title="React trading showcase" />

## Try it

- Switch symbols, timeframes, and candle, bar, line, or area charts.
- Toggle MA20, Bollinger Bands, RSI, MACD, and VWAP.
- Choose one, two, or four synchronized chart panels.
- Draw annotations, switch the theme, or export a chart as PNG.

## Source

The demo runs the standalone
[React app](https://github.com/FutureSeller/finchart/tree/main/apps/demo-react).
Its components and live-data wiring are shared with this preview.

<<< ../demo-react/src/App.tsx
