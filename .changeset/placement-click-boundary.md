---
"@finchart/tools": patch
---

Placing a drawing uses the chart pan's 5px click boundary: a press that travels exactly 5px before release is now a click and leaves the next anchor following the cursor. Only more than 5px, measured in a straight line from press to release, places the next anchor at the release point, which finishes a two-anchor drawing.
