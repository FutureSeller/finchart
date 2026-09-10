---
"@finchart/core": patch
---

For a year label, `timeTicks` asks the formatter for an era when the zone's Gregorian year is below 1. In the Gregorian calendar a year formatted without its era is the year within that era, so 1 BCE and 1 CE both rendered as "1", and every earlier year as a positive number belonging to a later one — an axis drawn across the boundary read `3, 2, 1, 1, 2, 3`. The era is asked for only when the zone's year is below 1, so with the default `en-US` Gregorian formatter an ordinary axis still reads "2026" and not "2026 AD".
