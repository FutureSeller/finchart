# Branch and tag rules

These JSON files are prepared GitHub API payloads. Committing them does not
apply protection. Apply them when the repository's visibility and plan support
rulesets. Keep write/admin access limited to maintainers; contributors use forks.

| Payload | Rules | Bypass |
| --- | --- | --- |
| [main-ci.json](main-ci.json) | Require `check`, `node-floor`, `e2e`, and `react-floor` from GitHub Actions against the current base; prohibit deletion and force pushes; require linear history | None, including owners and bots |
| [main-review.json](main-review.json) | Require PRs, one code-owner approval, dismiss stale approvals, resolve conversations, squash merge | `FutureSeller`, through a PR only |
| [release-tags.json](release-tags.json) | Prohibit moving or deleting `@finchart/*` release tags; creating them stays allowed (the Release workflow creates them and a hand publish pushes them) | None, including owners and bots |

Authors cannot approve their own PRs. The owner exception supports solo
maintenance while the separate CI rules remain mandatory. Use it for owner PRs
only; contributor and bot PRs receive an actual maintainer approval. The bypass
covers the entire review ruleset, so the owner must still resolve conversations.
Review this exception when another independent maintainer joins. Update owner ID
`50730028` and [CODEOWNERS](../CODEOWNERS) together if ownership changes.

## Applying

Confirm the repository and owner, then apply each payload once:

```sh
gh api --method POST repos/FutureSeller/finchart/rulesets \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --input .github/rulesets/main-ci.json
gh api --method POST repos/FutureSeller/finchart/rulesets \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --input .github/rulesets/main-review.json
gh api --method POST repos/FutureSeller/finchart/rulesets \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --input .github/rulesets/release-tags.json
```

Record returned IDs; use `PUT` to update existing rules instead of creating
duplicates. Read settings back and verify rejection of direct pushes, failed CI,
stale approvals, force pushes, deletions, and moving or deleting a release tag.
Verify an owner PR with successful CI can merge. Keep auto-merge disabled and
squash as the only merge method.

## Related repository settings

- Keep default Actions permissions read-only. Do not enable fork write tokens or
  fork access to secrets. Inspect workflows, install hooks, scripts, and dependency
  changes before approving external runs.
- Require approval for all outside collaborators' fork workflows after making
  the repository public.
- Keep `Allow GitHub Actions to create and approve pull requests` enabled for
  Changesets PR creation. It does not replace maintainer approval.
- Keep the `npm` environment's required reviewer set to a maintainer, with
  "Prevent self-review" off while one maintainer approves alone, "Allow
  administrators to bypass configured protection rules" off, and its
  deployment branches limited to `main`. The Release workflow's publish job
  waits there. With npm trusting only that environment and refusing tokens,
  this approval is what stands between a merged version PR and npm. See
  [Changesets](../../.changeset/README.md#releasing).
- Enable private vulnerability reporting, available secret scanning and push
  protection, and dependency alerts. [SECURITY.md](../../SECURITY.md) describes reports.
- Pin Actions to reviewed commit SHAs and review source when updating them.
  Require full-length SHA pinning and allow only the actions the workflows
  use (`actions/*`, `pnpm/action-setup`, `changesets/action`) in the
  repository's Actions settings.

See [GitHub's rulesets API](https://docs.github.com/en/rest/repos/rules) for the
payload schema. Public visibility and rule enforcement are separate steps.
