# Changesets

Contributors add changesets with `pnpm changeset`. Maintainers review release
scope and bump types, then merge the bot-generated version PR after required CI.
Changeset authors do not receive merge or publication access.

The Release workflow prepares version PRs only; it does not publish to npm.
Publishing is a separate maintainer operation described [below](#releasing).
See [Contributing](../CONTRIBUTING.md#changesets)
for changes that need a release and the empty-changeset convention.

The first public release was `0.0.1`; its baseline is recorded by the
`@finchart/*@0.0.1` Git tags.
Changes made before that release are recorded in each package's `CHANGELOG.md`;
they are not pending changesets. New changesets start with changes made after
that baseline.

## The five packages **go up as one version** (`fixed`)

The `fixed` group in `config.json` is this repository's only release rule.
Without it, the changesets default is **independent versions**, and the result
is an unmet peer on release day:

```
core alone becomes 0.1.0 while dom stays at 0.0.1
  → dom@0.0.1's peer is "@finchart/core": "^0.0.1"
  → ^0.0.1 means >=0.0.1 <0.0.2, so it **rejects** core@0.1.0
  → npm install reports an unmet peer from day one, and fixing it means
    republishing
```

`workspace:^` is substituted with the version of the moment during `pnpm pack`
(measured: `0.0.1` → `"^0.0.1"`). Since **the peer range is derived from the
version at publish time**, five packages that aren't on the same version reject
each other.

Lockstep is the convention in 0.x, but **a convention is not a machine** — which
is why this was judged a release blocker. It has to be written down here as
`fixed` for the next person pressing `changeset version` to take all five up
together.

## Prereleases: `pre` for a line, `--snapshot` for a throwaway

Two mechanisms, and the difference that matters is **whether they leave state
behind**.

`changeset pre enter canary` writes `.changeset/pre.json` — a tracked file. From
then on every `changeset version` produces `0.1.0-canary.0`, `.1`, `.2`, and it
keeps doing so until someone runs `changeset pre exit`. That is repo state, so
it changes what the Release workflow's version PR does too. Use it for a real
prerelease line aimed at a release, the way vitepress runs its 2.0 alphas.

`changeset version --snapshot canary` leaves nothing behind. It stamps every
package `0.0.0-canary-<timestamp>` for that one run and is meant to be thrown
away — a build for a PR or a tester, never something to release from. The name
can be anything: `--snapshot 'pr#123'`.

Both keep the `fixed` group together: a snapshot gives all five the same
timestamp, measured.

**Whichever you use, publish with `--tag`.** `changeset publish` with no tag
publishes to `latest`, so a canary would land on everyone running
`npm i @finchart/core`. `changeset publish --tag canary` is the whole
difference — it is what keeps vitepress's `latest` at 1.6.4 while its alphas sit
on `next`.

## When you add a package

**Put it in the `fixed` array too.** Leave it out and that package alone gets an
independent version, and the unmet peer above recurs there.

## Releasing

The Release workflow accepts successful CI for pushes to this repository's
`main` only. Its context and checkout must match the CI-verified SHA. It checks
that main is current before validation and again before updating the version PR.
Confirm the version PR is still current before merging, since main can advance
after the final check. Changesets Action 2 is paired with CLI 3.

1. Review the bot's `changeset-release/main` PR: all five versions, changelogs,
   dependency ranges, and lockfile changes. The version PR consumes existing
   changesets and is exempt from adding a new changeset.
2. Approve the bot's workflow run when GitHub requests approval, then approve and
   squash merge the PR after all required CI checks pass.
3. From a clean, current checkout, run `pnpm install --frozen-lockfile`, then
   `pnpm gate`. Inspect release artifacts and publish with `pnpm release` using
   maintainer credentials. Keep credential values out of tracked files and logs.
4. Verify all five versions and public access on npm, then check installation
   and imports in a clean consumer project. If publishing is interrupted, inspect
   registry state before retrying; published versions cannot be replaced.

The workflow does not publish or auto-merge. If automated publication is added,
review it separately and prefer npm trusted publishing with minimal permissions
and a protected release environment. Use an explicit non-`latest` tag for canaries.
