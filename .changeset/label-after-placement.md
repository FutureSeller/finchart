---
"@finchart/core": minor
---

`timeTicks` chooses which ticks to keep by what each boundary stands for, and labels the survivors afterwards. The frame used to snap a strategy's ticks onto bars and thin them by pixel after they were labelled, so whichever was closer or earlier survived — "2/2" took the Monday bar from "Feb" when the 1st fell on a weekend, and "Feb" lost to the "1/31" a few pixels in front of it when bars were packed. Now a boundary standing for a year is placed before one standing for a month, a month before a day, a day before a time of day; among equally weighted boundaries competing for pixel room the earlier is kept, and among those landing on one bar the one whose own boundary the bar sits nearest; labels are then decided from the ticks that remain. (A boundary is weighed by what it is, not by the label it would wear: a Monday after March 1 that would read "Mar" on a weekly rung weighs as a day.)

`TickStrategyContext` carries `positionOf` (where a value is drawn, in pixels) and, in a bar-index coordinate system, `snap` (which bar a boundary lands on). **A strategy now places its own ticks and the frame draws what it returns** — a custom strategy that relied on the frame snapping its ticks onto bars must call `context.snap` itself. At most a thousand boundaries are offered per rung, and the spacing rule keeps what fits among them.
