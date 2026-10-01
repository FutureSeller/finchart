---
"@finchart/indicators": patch
---

A tick no longer recomputes all of history for the fifteen indicators that used to. `rsi`, `atr`, `adx`, `parabolicSar`, `vwap`, `obv`, `keltnerChannels`, `superTrend` and `pivotPoints` now fold one bar from a checkpoint. `bollingerBands`, `stochastic`, `cci`, `williamsR`, `donchianChannels` and `ichimoku` re-run only the bars a tick can reach: the moved bars plus the window behind them, and for Ichimoku the displacement too. The output equals a full recompute exactly. With 100 000 bars, an `updateLast` with Bollinger Bands and RSI drawn went from about 93 ms to about 10 ms, which is the cost of the same chart with four moving averages.
