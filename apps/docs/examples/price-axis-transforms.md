---
description: "Renko, Line Break, Kagi and Point & Figure derived from one ticking candle chart — series whose x is not a clock, sized by the tape's own ATR."
---

# Price-axis transforms — Renko, Line Break, Kagi, Point & Figure

<script setup>
import * as mod from "../../examples/src/cases/price-axis-transforms";
</script>

<p>{{ mod.description }}</p>

<CaseDemo :case="mod" />

What this page shows, and what it cannot: the candles on top take a tick every 400 ms; the Renko chart is registered with `derive` and takes the same ticks — the bricks are re-derived from the accepted candles, the ordinals of the closed prefix stay put — and a moving average is attached to its bricks the way it would be to candles. Line Break, Kagi and Point & Figure are derived the same way, from the tape as it stood when the page opened. Every derived chart's x is an ordinal; the axis format reads the block's `closedAt` back as its label. The three price steps — brick, reversal, box — are one number, `atrPriceStep` of the tape; Line Break takes a count of lines, not a price. What does not fit this lineage (a volume pane, `infiniteHistory`, drawings that anchor to time) is in the guide's [Price-axis transforms](/guide/plot-contract#price-axis-transforms) section.

## Source

`apps/examples/src/cases/price-axis-transforms.ts` — the real thing, type-checked in CI.

<<< ../../examples/src/cases/price-axis-transforms.ts
