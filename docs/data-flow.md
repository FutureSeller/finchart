# Data flow and update contracts

Data travels through a typed registration before reaching layout and drawing.
Keep ingestion validity, calculation, and display sampling separate: a reduced
display dataset must not become the input to an indicator.

## Main path

```text
array or Source.read()
  registration: plain points or derived output
  data manager: validation, storage, viewport selection, decimation
  pane: value extents and representation
  plot: shared x mapping and frame coordination
  series.draw(): selected points become commands
```

The owners are [data types](../packages/core/src/data/types.ts),
[Entry](../packages/core/src/registration/entry.ts),
[SimpleDataManager](../packages/core/src/data/data-manager.ts), and
[SeriesHandle](../packages/core/src/plot/series-handle.ts).

## Accepted points and ownership

- x is numeric and finite. Convert dates and external time formats at the
  application's boundary. The manager checks ordering in the accessor's x space.
- Duplicate-x validity belongs to the accessor. The OHLC accessor requires
  unique x; do not impose that rule indiscriminately on every representation.
- A line value of `null` is whitespace. It preserves an x position and breaks
  the line. An OHLC bar requires four finite prices; optional volume may be
  missing or `null`. Missing fields, NaN, and infinity are not substitutes for
  supported whitespace.
- Stored arrays are copied on replacement, but point objects are retained.
  Callers must not mutate points after handing them over. `DataView` exposes a
  borrowed readonly view rather than a defensive deep copy.
- Keep the same array identity while a `Source` is unchanged; provide a new
  array when its content changes. Mutating an existing array bypasses the
  computation cache's change signal.

[accessors.ts](../packages/core/src/data/accessors.ts) defines the built-in
point rules. [validate.ts](../packages/core/src/data/validate.ts) is the shared
rule implementation for validation reports and rejecting write paths. Use
`validateSeriesData` for a report before submission; it does not repair data.

## Write operations have different meanings

| Handle operation | Meaning | Window behavior |
| --- | --- | --- |
| `setData` | Replace the registration's source data | Requests a refit by default; `refit: false` suppresses that request |
| `append` | Add a validated tail chunk | Preserves the held x window subject to configured following policy |
| `prepend` | Add a validated history chunk at the front | Preserves the held x window while updating membership |
| `updateLast` | Replace the last point at the same x, or append a later point | Uses the incremental update path rather than a full refit |
| `upsert` | Merge a sorted snapshot by x within the held history | Keeps untouched points and does not request a full refit |
| `swapSeries` | Replace the drawn representation | Keeps the registration and its data; updates value extents |

Chunk writes validate their ordering and seam against held data. `upsert` does
not remove held bars and refuses points before the held history starts; older
history belongs to `prepend`. Snapshot freshness remains the caller's concern.
The engine cannot know whether a snapshot should overwrite a live tick.

[merge-by-x.ts](../packages/core/src/data/merge-by-x.ts) implements reconciliation;
[upsert.test.ts](../packages/core/src/plot/__tests__/upsert.test.ts) exercises its
public behavior. If a `conflated` feed has a pending tick, flush it before a
snapshot merge to establish an explicit delivery order. See the
[live feed guide](../apps/docs/guide/live-feed.md).

Distinguish registration removal from chart teardown. Writes through an
evicted or disposed registration throw; late writes after pane/chart teardown
are handled differently. Read the handle's `attached` contract and
[series-handle.test.ts](../packages/core/src/plot/__tests__/series-handle.test.ts)
before changing this boundary.

## Derivations and shared computations

A registration can draw its own data, derive output from its full source, or
consume another `Source`. A derivation receives the complete source, including
history outside the visible window. Viewport clipping happens later.

[computation.ts](../packages/core/src/data/computation.ts) exposes named output
branches as sources. Reading several branches with unchanged input identities
reuses one computed result. Its cache key advances only after a calculation
succeeds, so a failed calculation must not mark stale output as current.

Full calculation is the fallback. Optional tail and head paths may reduce work
only when their change shape and output contracts hold. `null` from an
incremental calculation declines the path. Declared head lookback can update a
new prefix and retain a validated suffix; it also invalidates stale tail resume
state. The first subsequent tail update must recover valid calculation state.
Do not infer history corrections solely from the number of inserted points.

When changing these paths, compare incremental output with a fresh full
calculation after prepend, replace, and append sequences. The relevant guards
include [head-then-tail.test.ts](../packages/core/src/data/__tests__/head-then-tail.test.ts),
[landing-head-path.test.ts](../packages/core/src/plot/__tests__/landing-head-path.test.ts),
and [indicator landing tests](../packages/indicators/src/__tests__/landing.test.ts).

## Display selection and x mappings

Managers binary-search the viewport and reduce display points according to the
registration's decimation policy. The policy resolves field by field from the
registration, then series, then assembly. M4 is the generic default; candle
representations supply a strategy suited to OHLC values.

The plot owns a shared x mapping across registrations. Continuous x and
bar-index coordinates are different spaces; events and data ingestion still
use data x. Mapping changes must invalidate cached screen positions. See
[x-viewport.ts](../packages/core/src/plot/x-viewport.ts),
[decimation.ts](../packages/core/src/data/decimation.ts), and
[bar-index.test.ts](../packages/core/src/plot/__tests__/bar-index.test.ts).

For expected public behavior, use the
[Plot contract](../apps/docs/guide/plot-contract.md). For calendar and session
semantics, use [Time zones and sessions](../apps/docs/guide/time-zones.md) and
the implementation in [time](../packages/core/src/time/index.ts).
