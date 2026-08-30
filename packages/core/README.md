# @finchart/core

A headless financial chart engine you assemble yourself.

## Install

```sh
pnpm add @finchart/core
```

- **Core does the math, you do the pixels.** `createPlotModel` runs without a
  DOM or a canvas and hands back a list of draw commands. Core knows nothing
  about the DOM — not at runtime, not in its types. Browser wiring
  (`browserDeps` + `PlotBuilder`) is a set of collaborators that
  `@finchart/dom` layers onto the same Plot, the way react-dom sits on react.
- Series (candle, line, histogram, area, baseline, bar), panes, a bar-index
  x-axis, real-time appends (`updateLast`), and computed nodes. Drawing tools
  and indicators live in their own packages.
- Every collaborator is injected — leave one out and that job simply doesn't
  happen, and it never enters your bundle.

```ts
// Turn showGrid off — otherwise the grid is drawLine too, so the first
// command you get back is a grid line, not your series.
const model = createPlotModel({
  size,
  series: { series: lineSeries(), data },
  config: { showGrid: false },
});
const [line] = model.commands().filter((c) => c.type === "drawLine");
```

## Support matrix

- **Node 18+** — where the headless path (SSR, workers, tests) runs.
- **Browsers — Chrome 98+ · Edge 98+ · Firefox 94+ · Safari 15.4+** (2022-03).
  The floor is set by `structuredClone`, `Object.hasOwn`, and
  `Array.prototype.at`, and **no polyfills ship** — bring your own if you need
  to support something older.
- The repository's own toolchain (Node 24 · pnpm 11) is higher than this. That
  is **the contributor's floor**, not the consumer's.

## Docs

- **Style tokens** — the full CSS variable table — [`theme.md`](https://github.com/finchart/finchart/blob/main/apps/docs/guide/theme.md)
- **The Plot contract** — [plot-contract.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/plot-contract.md)
- **Glossary** — [glossary.md](https://github.com/finchart/finchart/blob/main/apps/docs/guide/glossary.md)
