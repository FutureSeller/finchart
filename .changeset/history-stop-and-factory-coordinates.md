---
"@finchart/core": minor
"@finchart/dom": patch
"@finchart/react": patch
"@finchart/tools": patch
"@finchart/indicators": patch
---

`infiniteHistory` takes a series handle where it took a sink function, and stops by itself when that handle is disposed mid-fetch — no more `ContractError` thrown out of the landing on a symbol switch. `HistoryStatus` gains a final `"stopped"`: `dispose()` on an idle or loading loader, or a lost handle, reads `"stopped"`; disposing a loader that is already `done` or `terminated` keeps that reason. **Migration**: an exhaustive `switch` or `Record<HistoryStatus, …>` needs a `stopped` case. `statusChanges` now notifies on every change with the state as it is at delivery — a change made from inside another listener can be heard twice, never stale. A listener or sink that disposes the loader mid-flight leaves it stopped, and a rejection after dispose is still consumed. `lineSeries` and `areaSeries` take `{ coordinates, style? }` as well as a style — `lineSeries({ coordinates: new OHLCAccessor() })` draws candles by their close, so a candle ↔ line toggle is `swapSeries` between two factories; a style key beside `coordinates` is refused. Every package exports `./package.json`, so `require.resolve("<name>/package.json")` works. The READMEs state the Node floor the packages declare (`engines >=20.19`), which CI now runs.
