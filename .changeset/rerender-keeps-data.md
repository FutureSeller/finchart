---
"@finchart/core": minor
"@finchart/react": patch
---

A re-synced series spec whose new series object reads and thins points exactly as the old one (every built-in series, rebuilt on a React re-render) keeps its data instead of rebuilding the data manager and validating the whole history again; the built-in series share one frozen accessor per point shape to make that recognizable. A reused spec's `name`, `color`, `zIndex` and `readout` now reach the chart, so a `<ChartLine>` whose colour or name changes updates its legend and tooltip swatch, not only its stroke; `SeriesSpec` carries the four fields and `seriesSpec()` checks `zIndex` and `readout` where it is called. `derive` and `deriveLast` are called on the registration, so a derivation written as methods can use `this`. The deprecated `DataManager.adoptHeadGrown` door is removed — implement `adoptHeadRetainingTail`.
