---
description: "x is an instant and the axis decides the zone: tell timeTicks the exchange's zone and locale, aggregate on epoch-aligned bars or calendar-day sessions, anchor indicators to the session, and know what the runtime default hides."
---

# Time zones and sessions

This page assumes your x is a timestamp in milliseconds — an instant. If your
x is in seconds or some other unit, `timeTicks` takes `epochOf` and
`xOfEpoch` and the axis section still applies; the aggregation and anchor
recipes below do not — `barAggregator` and `periodAnchor` hand the raw x to
the `BarStart`, so they want milliseconds or a `BarStart` of your own written
for your unit.

## x is an instant; the axis decides the zone

The data never carries a zone. A bar's `x` is the instant it opened, the same
number in Seoul and in New York, and every conversion happens **once, at your
boundary**:

```ts
const candles = rows.map((row) => ({ ...row, x: row.time.getTime() }));   // Date objects
const candles = rows.map(({ time, ...row }) => ({ ...row, x: time * 1000 })); // seconds
// A date string must say its zone. new Date("2026-08-16") is UTC midnight and
// "2026/08/16" is local midnight — and the second form is not even portable.
const candles = rows.map((row) => ({ ...row, x: Date.parse(`${row.day}T00:00:00Z`) }));
```

Where a zone appears is the **axis**. `timeTicks({ timeZone, locale })` places
the ticks on that zone's calendar boundaries and words them in that language;
and the same strategy formats the decorations — the crosshair badge and the
tooltip header read the same clock, to the second. One option, one clock —
the axis, the crosshair badge and the tooltip header. A `format` of your own on `axis.x` still wins for the decorations
(the strategy keeps its own tick labels — see the
[plot contract](/guide/plot-contract)).

<<< ../snippets/time-zones.ts{ts}

## The default is the runtime's — say the zone

Leave `timeZone` out and the strategy formats in the runtime's zone; leave
`locale` out and it words things in the runtime's language. That is the
JavaScript default, and it is a trap for a chart: a headless render on a
server in UTC and a browser in Seoul print different labels for the same bar,
and so do two colleagues' machines. This is not a hydration problem — the
server does not render the labels — it is two clocks. Say the exchange's zone
and an explicit locale, and the labels are the same everywhere.

## Aggregation: epoch bars and calendar sessions

Two kinds of bar boundary, and they are different tools:

- **`fixedBars({ interval })`** — bars of a fixed width, aligned to the epoch:
  the minute, hour and four-hour bars of a market that never closes. At most
  a day wide, because past a day the epoch is the wrong ruler (an
  epoch-aligned week starts on a Thursday). Intraday bars aligned to an
  exchange's *open* rather than to the epoch are a few lines of your own
  `BarStart`.
- **`sessionStart({ timeZone })`** — where a session starts, for a market whose
  session is a calendar day in one zone. The zone is required here, unlike on
  the axis, because this decides an x that gets **stored** — into a daily bar,
  a drawing's coordinates, a history cursor — and a default would let a server
  in UTC and a browser in Seoul disagree about the same bar. It opens the day
  at its earliest real instant, so the days a clock moves are handled.

Only "a session is a calendar day" lives there. A holiday, a half day, or an
open that crosses midnight is your knowledge, and `BarStart` is the tool to
write it with. Both go into `barAggregator({ barStart })`; the
[live feed guide](/guide/live-feed) shows the aggregator inside a real feed.

## Indicators that reset at the session

VWAP and pivot points restart at a boundary — a session, a week. They take an
`anchor` predicate, and `periodAnchor({ barStart })` builds one from any rule
about where a bar starts, including `sessionStart({ timeZone })`. The snippet
above anchors a VWAP to the Seoul session.

## Two markets

Regular sessions; both exchanges publish calendar exceptions (holidays, half
days) that are yours to apply.

| Market | `timeZone` | Regular session | Daylight saving |
|---|---|---|---|
| KRX (Korea) | `Asia/Seoul` | 09:00–15:30 | none |
| NYSE (US) | `America/New_York` | 09:30–16:00 | yes — the zone applies it; your `x` values never change |

The zone name carries the daylight-saving rule, so a New York chart in March
and in November needs no change from you: the same `timeTicks({ timeZone:
"America/New_York" })` labels both correctly, and `sessionStart` opens each day
at its real 00:00 there.

## Shading the hours

The [session shading example](/examples/session-shading) covers the after-hours
stretch with a gradient band drawn through a custom command with a flat
fallback. Read it for what it is: how a decoration recovers time from the axis
ticks (`x.fromDomain(tick.value)` — a tick's value is a domain value, an index
under bar-index coordinates) and how a fallback travels with a command. Its
hours are read in UTC and each band runs one tick spacing from a tick, so it is
an approximation, not a session calendar.
