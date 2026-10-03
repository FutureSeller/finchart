---
"@finchart/core": minor
"@finchart/react": minor
---

React gets the pieces a real trading screen was hand-rolling around the chart. `useInfiniteHistory` holds paged history as React state together with the loader's place — the first bar held, the paging token, the end — and `<InfiniteHistory history>` inside the chart pages into it: a chart remounted under a `key` resumes instead of asking for the first page again, a page landing for a load `reset` replaced is dropped, and `status` is state. `<Plugin install deps onApi>` puts a tool on the chart as a child and hands its api to the parent (after commit, and `null` before it's disposed). `<ChartPane valueDomain={[min, max]}>` declares a fixed value range — an oscillator pane — applied when its two numbers change, and `<ChartPane yScale>` now follows its prop: a factory handing out another kind of scale swaps it in place, keeping the pane, its series and its height, and removing it puts back a linear scale (on the main pane, the one it replaced). In core, the cursor-mode loader reads `cursor()` — the token the next fetch would take, moved by an empty page too — typed on the new `CursorHistoryLoader`.
