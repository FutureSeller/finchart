---
"@finchart/dom": minor
"@finchart/react": patch
---

The wheel zooms by how far it moves: `zoomSpeed` per 100 px (one mouse notch), with line and page deltas converted to pixels and at most one notch per event, so a trackpad's stream of small deltas no longer slams the chart to its zoom limit. A mostly sideways wheel or trackpad swipe pans instead of zooming. The tooltip measures itself and flips to the other side of the cursor at the right and bottom edges of the pane it is over instead of overflowing them, even in a container larger than the chart. Pointer positions are measured from inside the container's border, where the canvas sits. Destroying the chart hands the container back without the `tabindex`, `touch-action` and `position` it added. The legend's default text colour is inherited from the page instead of a dark slate that vanished on dark themes. In React, unmounting `<XAxis>` or `<YAxis>` reverts what it applied, so a toggled-off axis format or a keyed pane swap no longer keeps the old format.
