---
"@finchart/core": patch
---

A listener removed during an emit — by an earlier listener, or by `destroy()` called from one — is no longer called later in that same emit; this holds for `plot.on`, `pane.subscribe` and every extension stream. A listener that throws still has its error reported, but the change it was told about now finishes: the first data's value-axis fit runs, and the frame is still requested (after `addPane`, `removePane` and pane option changes too). `addPane` still returns its pane when a `panesChange` listener throws; the listener's error is rethrown out of band. A manual value range set before the first data arrives (`setValueDomain`) is kept by the first data fit instead of being overwritten.
