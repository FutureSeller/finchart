---
"@finchart/core": minor
"@finchart/dom": patch
---

A divider handle moves only the two panes it was drawn between: `DividerBoundary.panes` names them, the chart refuses a move whose pair has changed since the last frame, and the DOM dividers end a drag when a different pair is drawn at the handle's slot — removing or inserting a pane mid-drag no longer resizes another pair.
