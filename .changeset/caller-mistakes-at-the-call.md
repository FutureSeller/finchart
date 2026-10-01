---
"@finchart/core": patch
---

Mistakes are refused where they are made instead of failing on a later frame, pan or input: `on(event, handler)` refuses an event name the chart does not emit and a handler that is not a function, as does `pane.subscribe` and every extension stream's `subscribe`; pane `autoScale`/`invert` must be booleans (`"false"` from storage is truthy); an axis `format` must be a function and `ticks` an object with `ticks()` (chart and pane `axis` options); `timeTicks({ epochOf, xOfEpoch })` must be functions; `setData(data, { refit })` must be a boolean; `addInputConsumer` needs a `handle` function and a finite `priority`; `takeScreenshot()` on a destroyed chart throws instead of returning the old picture. `paneMaximize().maximize(pane)` refuses a pane that is no longer on the chart (it used to collapse every live pane), and `maximize`, `restore` and `load` throw after the extension was disposed.
