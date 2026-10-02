---
"@finchart/core": patch
---

A divider drag pairs every pane with its height before writing any of them. A pane subscriber that removed a pane in reaction to the first write used to shift the list under the drag, handing a later pane the removed one's height; now each surviving pane gets its own, and a pane removed before its turn is left alone.
