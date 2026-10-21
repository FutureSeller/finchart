---
description: "Two symbols on one pane as percent change from the first bar on screen, recomputed as the window moves — a recipe on line series, not a scale mode."
---

# Comparing symbols — percent change on one pane

<script setup>
import * as mod from "../../examples/src/cases/compare";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

## How it works

- Each symbol becomes a line series of `(close / baseClose − 1) × 100`, and the value axis format prints it with a `%` sign. The legend reads the same format, so the cursor's values are percentages too.
- The base is the first bar on screen. An `xDomainChange` listener recomputes both lines with `setData(…, { refit: false })` when that bar changes, so the window the user dragged to stays put, and an auto-scaling value axis follows the new lines on the next frame.
- The listener skips a window that starts on the same bar, so a drag within one bar replaces nothing.

## React

The same recipe in the React lane: the window's start is state, `onXDomainChange` moves it, the base is read off the bars at render, and `useMemo` recomputes the lines when the base changes. A changed `data` prop doesn't refit, so the window the user dragged to stays put without a `refit` option. The file carries its own copy of `percentFrom` and `baseX`, so it can be copied whole.

<<< ../snippets/compare-react.tsx{tsx}

## Limits

- The pane's values are percentages. A drawing or `priceLine` added to it is placed in percent, not in either symbol's price, and stays put while the lines move under it each time the base changes; keep price-anchored drawings on a chart of their own, linked with [`syncX`](/examples/sync-x).
- Each time the first bar on screen changes, every line is recomputed and replaced in full, so a drag costs more the more history the chart holds.
- Both symbols here share one bar grid. Symbols that trade on different days need their bars matched by `x` first, or each line measures from a different day.
- To measure from a fixed day instead of the window, compute the lines once with that day's `x` and leave out the listener.

## Source

`apps/examples/src/cases/compare.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/compare.ts
