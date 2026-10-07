# Contributing

Read [PRINCIPLES.md](PRINCIPLES.md), [AGENTS.md](AGENTS.md), and the
[developer documentation](docs/README.md) before changing code. Follow the
[development guide](docs/development.md) for setup and verification.

## Pull requests

1. Fork the repository and create a focused branch.
2. Explain the behavior, affected packages, and relevant consumers before editing.
3. Add regression coverage for behavior changes and update affected documentation.
4. Run the relevant checks, then `pnpm gate`. List results and any unrun checks.
5. Open a PR against `main` with a clear summary and release impact.

Only maintainers receive write access and merge PRs. An approval does not grant
merge permission. Maintainers review public contracts, test evidence, dependency
changes, and release scope before merging. PRs are squash merged after required
checks and review conversations are complete. New commits invalidate approvals.

Fork CI uses a read-only token and receives no repository secrets. Maintainers
inspect workflow and script changes before approving a fork workflow run.
Contributors must never add credentials, account data, personal market snapshots,
or private development records. Keep local environment files ignored; examples
use blank `.env.example` files and synthetic data.

## Changesets

Add a changeset with `pnpm changeset` when a published package changes its runtime
behavior, public API, types, dependencies, or shipped artifacts. Describe the
consumer-visible result and select the affected package and bump type.

Docs, tests, private apps, and internal refactors that leave shipped behavior
unchanged do not require a version bump. Changes confined to a package's
`src/**/__tests__/` never reach its published files, so CI does not count them
as package changes. When CI detects any other package change that needs no
release, use `pnpm changeset --empty` and explain why in the PR.
CI checks changesets added since the PR's target branch. It does not prove that
every affected package or the selected bump type is correct; the maintainer
reviews those decisions. The trusted bot's version PR consumes existing
changesets and is exempt from this addition check.

Contributors may write changesets. Maintainers approve them and merge the
bot-generated version PR. Do not manually edit package versions or changelogs in
normal feature PRs. All five public packages release together through the fixed
group in [.changeset/config.json](.changeset/config.json).

See [branch rules](.github/rulesets/README.md) for protection settings and
[Changesets](.changeset/README.md#releasing) for release operations.
Report vulnerabilities using [SECURITY.md](SECURITY.md).
