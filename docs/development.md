# Development and verification

Use [PRINCIPLES.md](../PRINCIPLES.md) for contribution rules and
[Architecture](architecture.md) to identify the owner before editing. Define
contracts first, test changed behavior, and keep changes small enough to
verify against the actual consumers.

## Toolchain and setup

The repository toolchain is distinct from the packages' runtime support:

- [.nvmrc](../.nvmrc) pins Node 24.21.0; root
  [package.json](../package.json) declares Node >=24.21.0.
- Root `packageManager` pins pnpm 12.9.1. Workspace versions and catalogs are
  in [pnpm-workspace.yaml](../pnpm-workspace.yaml); retain the lockfile.
- Published runtime packages declare Node >=20.19. CI tests that floor after
  building with the repository toolchain.
- React peers start at 18.0.0; the workspace catalog uses React 19. A separate
  CI job verifies the React peer floor.

From the repository root:

```sh
nvm use                         # if using nvm
pnpm install --frozen-lockfile
pnpm build
pnpm --filter charts-examples dev
```

The install's `prepare` step configures `.githooks` as the Git hook directory.
Workspace consumers resolve built package exports, so build packages before
running an app or a standalone distribution check.

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @finchart/core test` | Run the core suite |
| `pnpm --filter @finchart/core exec vitest run src/plot/__tests__/upsert.test.ts` | Run one targeted regression file |
| `pnpm type-check` | Check workspace types, including test contracts |
| `pnpm lint` | Check workspace source and repository scripts |
| `pnpm test:coverage` | Run workspace tests with coverage thresholds |
| `pnpm --filter charts-docs build` | Generate API docs and build the user site with page-link validation |
| `pnpm --filter charts-docs type-check` | Check documentation snippets and configuration |
| `pnpm size` | Check measured bundle scenarios against budgets |
| `pnpm check:publish` | Run workspace publication validators |
| `pnpm --filter charts-e2e e2e` | Run Playwright against the examples app |

Install the required Playwright browsers before browser tests. The projects and
server setup are in [playwright.config.ts](../e2e/playwright.config.ts). These
tests assert real canvas pixel properties and input behavior; recording-renderer
tests alone cannot establish browser playback correctness.

Use targeted tests during implementation, then the gate for completed changes.
Headless command tests verify geometry and contracts without a browser. Type
tests verify public shapes. Add real-browser coverage when correctness depends
on canvas, DOM, focus, or pointer behavior.

## Change checklist

Before editing, identify the owning module, public entrypoints, callers, and
the tests that exercise the behavior. Record the current working-tree changes
so an existing edit is not mistaken for your work. Start from the table below,
then follow any additional consumers found in code.

| Change | Read first | Verification starting point |
| --- | --- | --- |
| Package imports or exports | [Architecture](architecture.md), manifests, source barrels | Module boundary tests, public-barrel and package-boundary checks; types, bundle limits, and artifact checks for published changes |
| Data writes, history, computations | [Data flow](data-flow.md), the owning accessor and entry | [Handle tests](../packages/core/src/plot/__tests__/series-handle.test.ts), [upsert tests](../packages/core/src/plot/__tests__/upsert.test.ts), full/incremental equivalence and history-then-tick regressions |
| Layout, style, renderer, scheduling | [Rendering](rendering.md), the relevant frame or playback implementation | Headless commands, [frame tests](../packages/core/src/plot/__tests__/frame.test.ts), style checks, and browser tests for actual playback or DOM behavior |
| Indicator, plugin, drawing tool | [Extensions](extensions.md), host capabilities, installation and disposal | Numeric full/incremental equivalence, lifecycle tests, [drawing tests](../packages/tools/src/__tests__/drawings.test.ts), and a runnable example |
| React hooks or composition | [usePlot](../packages/react/src/hooks/use-chart.ts), component owners | [Hook tests](../packages/react/src/__tests__/use-chart-plot.test.tsx), remount and StrictMode cases, subscriptions, retained state, and peer-floor compatibility when affected |
| Developer or user documentation | The corresponding index, linked source, and snippets | Relative links and headings; user-site build and snippet type checking when `apps/docs` changes |

For behavior changes, establish the failure with a test before implementing.
Check the relevant edge sequences rather than only the normal path: invalid
input and retained state, repeated disposal, callback-time removal, history
landing followed by a tick, or a React remount. Choose the cases belonging to
the changed contract instead of mechanically running every case in this list.

After implementation, verify the public consumer as well as the helper you
changed. A source-level test does not establish that the exported type, built
package, or browser adapter still works. Use the local gate for the completed
implementation and additional CI jobs when their surfaces are affected.
For prose-only work, inspect links, examples, and claims directly; document
which checks ran instead of implying a full implementation gate ran.

These instructions are a starting map, not a frozen list of all regressions.
If a task reveals an invariant missing from the documentation, add a concise
explanation beside its owner and link the protecting test.

## Local gate and CI

```sh
pnpm gate
pnpm gate --force
```

[gate.sh](../scripts/gate.sh) builds workspaces, checks types, lint and bundle
limits, validates publication metadata, runs coverage, and invokes repository
checks. `--force` forces Turbo tasks. On success it records the validated
working-tree hash; [pre-commit](../.githooks/pre-commit) reuses the stamp only
when it matches the staged tree. The gate uses a temporary Git index rather
than staging changes for you.

[scripts/README.md](../scripts/README.md) lists individual check contracts.
For example, run `node scripts/docs-anchor-check.mjs` after changing user-guide
headings and `node scripts/llms-txt-check.mjs` after adding user-site pages.
Those checks target `apps/docs`; root developer documents need their own
relative-link review.

[ci.yml](../.github/workflows/ci.yml) has separate check, Node-floor, browser,
and React-floor jobs. `gate-parity-check.mjs` compares the local gate with the
CI check job and documents exemptions; it does not run the other jobs. CI sets
`FINCHART_SKIP_STRESS=1` for coverage, while the normal local gate retains the
long sweeps. Do not describe a focused test run as equivalent to all CI jobs.

## Packaging and releases

```sh
node scripts/release-artifact-check.mjs
node scripts/release-artifact-check.mjs --consume
```

The default check packs the runtime packages with pnpm and inspects exports,
files, license, metadata, source-map references, and peer compatibility.
`--consume` additionally installs the tarballs into a fresh consumer and runs
ESM and CJS smoke programs; it needs network access. `--self-test` only checks
the peer-range predicate and does not validate a package artifact.

Use pnpm packing for workspace-protocol rewriting. The published packages are
versioned together by the fixed group in
[Changesets configuration](../.changeset/config.json). Changes to exports,
peer ranges, or published files need artifact evidence, not only source tests.
Root release commands are in [package.json](../package.json); publication is a
separate operation from validating a change.

## Updating documentation

- Update root `docs` for contributor-facing implementation or workflow changes.
- Update `apps/docs` and package READMEs for public usage and contract changes.
- Keep snippets connected to compilation or tests where practical.
- Update inbound links when changing files or headings; generated TypeDoc and
  `llms.txt` content should be rebuilt rather than edited by hand.
- Preserve private design records outside this tree. Current explanations must
  stand on their own and agree with source and tests.
