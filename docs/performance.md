# Performance measurement and regression checks

Measure before optimizing, as required by [PRINCIPLES.md](../PRINCIPLES.md).
Use current code and a reproducible workload to decide whether an optimization
is needed. Historical measurements explain prior decisions; they are not a
claim about today's implementation or every consumer's machine.

## Three kinds of evidence

| Evidence | What it establishes | Where |
| --- | --- | --- |
| Deterministic work checks | Cache reuse, mapping work, and selected algorithm paths | [perf-invariants.test.ts](../packages/core/src/__tests__/perf-invariants.test.ts) |
| Bundle limits | Bytes shipped for named consumer import scenarios | Package `.size-limit.json` files and [bundle-table-check.mjs](../scripts/bundle-table-check.mjs) |
| Browser measurements | Frame timing, cold start, event-loop delay, and allocations under a specified workload | [bench.ts](../apps/examples/src/bench.ts) and [bench-driver.mjs](../e2e/bench-driver.mjs) |

These are different questions. Fewer counted operations do not by themselves
prove lower browser latency. Timing improvement does not excuse wrong command
output, lost extrema, or broken history behavior. A runtime option disabling
behavior does not prove that its code disappeared from a bundle.

## Running the browser harness

Build packages, then start the examples server in one terminal:

```sh
pnpm build
pnpm --filter charts-examples exec vite --port 5199 --strictPort
```

The harness is at `http://localhost:5199/bench.html`. It publishes completed
results on `window.__bench`. The Playwright driver lives in `e2e` and defaults
to that URL:

```sh
node e2e/bench-driver.mjs time
node e2e/bench-driver.mjs alloc 150
node e2e/bench-driver.mjs heap 0 1 3
```

The driver uses installed Chrome through `channel: "chrome"`. `BENCH_URL` and
`BENCH_DPR` select the URL and device scale factor. Scenario indices for heap
sampling come from the current harness; check them before copying an old
command. The harness's paired tests and scenario definitions are the workload
source, rather than an internal wrapper script.

## Comparison protocol

1. Record the commits or working-tree diffs being compared. Also record browser
   and runtime versions, OS, viewport, DPR, series mix, data size, and build mode.
2. Match the workload to the change: pan, same-bar replacement, new-bar append,
   history landing, post-landing tick, cold start, or multiple chart instances.
3. Prefer alternating baseline and variant runs under the same browser session.
   Report paired ratios and their spread, alongside median and p95 timings.
4. Check output equivalence separately: commands, values, or actual canvas
   properties, as appropriate. Include the full path when testing incremental
   calculations.
5. Preserve the result with its conditions and reproduction command in the
   change description or a committed benchmark report. Re-measure before
   reopening an optimization previously deferred on measured evidence.

The nominal frame interval is 1000 / refresh rate: approximately 16.7 ms at
60 Hz and 8.3 ms at 120 Hz. Treat these as context for a measured workload,
not an automated promise that every chart completes within either interval.
Report both typical work and the occasional landing or startup stall.

## Scope and limitations

Read the actual harness boundaries. A timer around command generation and
canvas submission does not measure completed GPU rasterization or screen
presentation. Sustained rAF timing and event-loop delay answer additional
questions. Main-thread allocation sampling is not total retained memory or
total canvas backing-store memory.

Shared-runner timing is noisy; the current CI gate checks deterministic work
and bundle limits rather than absolute frame-time thresholds. When adding a
new fast path, preserve its correctness fallback and write a regression that
distinguishes useful reuse from skipped validation. Counter coverage needs to
remain nonempty if collection or matching changes.

## Bundle changes

Run `pnpm size` after changing exports, static imports, or browser assembly.
Use the scenario's actual import graph. Compare `browserDeps` with explicit
assembly only under matched representations and build settings; a preset can
retain referenced code even when a runtime flag disables execution.

The budgets and user-facing numbers are checked by
[bundle-table-check.mjs](../scripts/bundle-table-check.mjs). Update the scenario,
budget, and published table together when an intentional contract change
requires it. Public numbers are scenario measurements, not cross-library
comparisons. See the [bundle guide](../apps/docs/guide/explicit-wiring.md).
