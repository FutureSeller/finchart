# Repository checks

Run `pnpm gate` from the repository root. It builds the workspaces, checks types,
lint, bundle budgets and package metadata, runs coverage tests, and then runs the
checks below. The gate records a successful working-tree hash, which the
pre-commit hook reuses when it matches the staged tree.

These checks use this repository's code, built packages and public documentation.
They do not require the private development checkout in `.tmp`.

| Check | Contract |
| --- | --- |
| `ssr-smoke.mjs` | Built packages import and render commands without browser globals |
| `headless-types-check.mjs` | Core declarations compile without the DOM library |
| `public-barrel-check.mjs` | Published source barrels list exports explicitly |
| `package-boundary-check.mjs` | Relative imports stay inside their workspace |
| `style-vars-check.mjs` | Shared CSS variables have consistent fallbacks across packages |
| `release-artifact-check.mjs` | Packed packages contain exports, licenses and valid dependency metadata |
| `bundle-table-check.mjs` | Public bundle tables match measured scenarios and budget files |
| `docs-anchor-check.mjs` | Public documentation anchors exist |
| `examples-doc-check.mjs` | Gallery titles and navigation match example modules |
| `indicators-matrix-check.mjs` | Published indicator tables match implementations and defaults |
| `issue-codes-check.mjs` | Documented data issue codes match the validator |
| `llms-txt-check.mjs` | Public documentation pages provide descriptions |
| `repo-url-check.mjs` | Published metadata and documentation point to this repository |
| `gate-parity-check.mjs` | The local gate includes the CI check job's validation commands |

`headless-types-check.tsconfig.json` supplies the DOM-free compiler settings.
`e2e/node-floor-smoke.mjs` also runs in the gate and tests the built runtime API.
CI runs it separately on the minimum supported Node version.

For a fresh consumer installation of all package tarballs, run:

```sh
node scripts/release-artifact-check.mjs --consume
```

Checks of private architecture and performance records, the checker mutation
suite and its diagnostic snapshot stay in the private development checkout.
ADRs and planning records are not inputs to this repository's gate.
