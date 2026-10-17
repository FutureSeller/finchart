# Changesets

Contributors add changesets with `pnpm changeset`. Maintainers review release
scope and bump types, then merge the bot-generated version PR after required CI.
Changeset authors do not receive merge or publication access.

The Release workflow prepares version PRs and, once a maintainer approves the
`npm` deployment, publishes a merged version to npm; see [below](#releasing).
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

**Publish a snapshot with `--tag`.** `changeset publish` with no tag
publishes to `latest`, so a canary would land on everyone running
`npm i @finchart/core`. `changeset publish --tag canary` is the whole
difference — it is what keeps vitepress's `latest` at 1.6.4 while its alphas sit
on `next`. A `pre` line released through the Release workflow needs no flag:
`changeset publish` publishes it to the tag `changeset pre enter` set (`canary`
above). The flag is for a snapshot, which is published by hand.

## When you add a package

**Put it in the `fixed` array too.** Leave it out and that package alone gets an
independent version, and the unmet peer above recurs there.

## Releasing

The Release workflow accepts successful CI for pushes to this repository's
`main` only. Its context and checkout must match the CI-verified SHA. It checks
that main is current before validation and again before updating the version PR
or offering a publish. Confirm the version PR is still current before merging,
since main can advance after the final check. Changesets Action 2 is paired with
CLI 3.

1. Review the bot's `changeset-release/main` PR: all five versions, changelogs,
   dependency ranges, and lockfile changes. The version PR consumes existing
   changesets and is exempt from adding a new changeset.
2. Approve the bot's workflow run when GitHub requests approval, then approve and
   squash merge the PR after all required CI checks pass.
3. CI on the merged commit starts the Release workflow. When that commit is
   still current main and a package version on it is missing from npm, the
   `publish` job waits in the `npm` environment for a maintainer to approve
   it under "Review deployments". Approving builds and publishes those
   versions unless main has moved since, then creates the
   `@finchart/*@<version>` tags and a GitHub release for each, with that
   package's changelog entry.
4. Verify all five versions, public access, and provenance on npm, then check
   installation and imports in a clean consumer project.

Approve or reject a waiting publish promptly; a later one waits behind it,
replacing any that was already waiting.

Every Release run on current main checks npm again, so a version that was not
published — main moved on before the check, the approval was rejected, or the
job failed — is offered again by the next push to main, as long as no package,
root manifest, lockfile, or LICENSE has changed since the commit that set that
version. Once one has, the run warns instead. Let the next version PR replace
that version, or publish it by hand from a clean checkout of that commit:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter='./packages/*'
node scripts/release-artifact-check.mjs
pnpm release  # prompts for 2FA; the packages require it and refuse tokens
git push origin 'refs/tags/@finchart/*:refs/tags/@finchart/*'
```

Then give each pushed tag the release the workflow would have made: titled
with the tag, its package's changelog entry for that version as notes, marked
as a prerelease for a prerelease version, and Latest only for core.

To retry sooner after `publish` failed, re-run that job: versions already on
npm are skipped, and every released version is tagged and given its release.
Published versions cannot be replaced. A run refuses to publish once main has
moved, so an older version never becomes `latest` that way.

If only tagging or the releases failed, no later run retries them, since
nothing is left to publish: re-run the job before main moves, or create the
missing `@finchart/*@<version>` tags at the published commit, and their
releases, by hand.

Publishing uses npm trusted publishing, so no npm token is stored in GitHub.
Each package's npm settings hold:

- a trusted publisher for `FutureSeller/finchart`, workflow `release.yml`,
  environment `npm`, allowed to publish directly with `npm publish` (new
  configurations allow only `npm stage publish` until that is ticked);
- publishing access "Require two-factor authentication and disallow tokens",
  so a token cannot publish either; revoke any npm token with publish rights
  that is left over.

A new trusted publisher expires unless it publishes within two days, so create
it within two days before approving the publish that first uses it; delete and
re-create one that expired. npm configures trusted publishing only for a
package that exists, so a new package is published once by hand with 2FA, then
given these settings, before the workflow can release it. The `npm` environment
requires a maintainer reviewer and allows only `main`. The workflow does not
auto-merge.
