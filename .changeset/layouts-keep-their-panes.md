---
"@finchart/core": minor
"@finchart/dom": patch
"@finchart/react": patch
---

Saved layouts no longer land on the wrong panes. An unkeyed pane-state slice pairs with a pane by position only when there is one slice for every pane — after a pane was added or removed, which one moved is unknowable, so nothing is guessed (give panes a `stateKey` to restore across layout changes). `paneMaximize` payloads carry each pane's `stateKey` (format 2) and load only onto panes with the same keys in the same order. **A saved format-1 payload no longer loads**: `load()` returns `false` for it and leaves the panes as they are, so save the maximize again after upgrading. A divider handle moves only the two panes it was drawn between: `DividerBoundary.panes` names them, the chart refuses a move whose pair has changed since the last frame, and the DOM dividers end a drag when a different pair is drawn at the handle's slot — removing or inserting a pane mid-drag no longer resizes another pair. `<ChartContainer state>` restores only the panes that just attached, so toggling a pane no longer replays the saved layout over a divider drag.
