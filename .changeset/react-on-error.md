---
"@finchart/react": minor
---

`<ChartContainer onError>` takes the data the chart refused. Declarative `data` that fails the core's checks (out of x order, a non-finite value) used to throw from an effect to the nearest error boundary — around a Next.js page, the whole page. With `onError`, the `DataError` is reported instead and the chart keeps drawing its last good data (a sync is checked whole before any of it applies); the next good `data` lands as usual, and the same refused render is reported once. Without `onError` nothing changes, and a `ContractError` — a mistake in the code rather than bad data — still throws either way.
