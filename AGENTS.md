# Working in this repository

## Start here

Read [PRINCIPLES.md](PRINCIPLES.md) and the
[developer documentation index](docs/README.md) before making changes.
Use [architecture](docs/architecture.md) to find the owner, then read the
topic relevant to the task. Use the
[change checklist](docs/development.md#change-checklist) to choose verification.

The repository must provide enough context without session memory or access
to private development records. Check current source, public exports, callers,
and tests before relying on a documentation claim. If behavior and documentation
disagree, investigate and report the discrepancy; do not silently treat either
as the intended specification.

## Workflow

- Inspect the working-tree diff before editing. Preserve unrelated changes.
- For work spanning multiple files or contracts, state the target files,
  intended changes, and verification plan first.
- Follow the interface-first and test-first process in PRINCIPLES for behavior
  changes. Keep edits bounded to the task.
- Start with relevant regression tests, then follow the development guide's
  verification requirements. Report checks that failed or were not run.
- Update the affected developer and user documentation with contract changes.
- Summarize what changed, the verification evidence, and remaining limits.

## Repository boundaries

- `docs/` contains English contributor documentation; `apps/docs/` contains
  English user documentation. Private ADRs are not published here.
- `.tmp/`, when present, is a separate local development checkout. Leave it
  untouched unless the user explicitly asks to change it. Do not make public
  builds, tests, or documentation depend on it or recreate symlinks to it.
- Import other workspaces through declared package dependencies. Respect core
  module directions and explicit public exports.
- Treat generated `dist`, TypeDoc pages, and LLM documentation as build output.
  Change their sources and regenerate them rather than patching output.
