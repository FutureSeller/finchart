#!/usr/bin/env bash
#
# Validate the repository and stamp the successful working-tree hash.
# Usage: scripts/gate.sh [--force]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Force all turbo tasks, including the coverage task, when requested.
if [ "${1:-}" = "--force" ]; then
  export TURBO_FORCE=true
fi

# Use a temporary index so validation does not stage the user's changes.
worktree_tree() {
  local tmp
  tmp="$(mktemp)"
  cp "$(git rev-parse --git-path index)" "$tmp" 2>/dev/null || true
  GIT_INDEX_FILE="$tmp" git add -A
  GIT_INDEX_FILE="$tmp" git write-tree
  rm -f "$tmp"
}

tree="$(worktree_tree)"

echo "▶ Repository gate"
echo "  Tree ${tree}"

# Preserve each command's exit status.
npx turbo run build type-check lint size
# Packing can rebuild dist. Finish size and type checks before packing.
npx turbo run check:publish
# Include the coverage thresholds configured in each workspace.
pnpm test:coverage
npx oxlint scripts

node scripts/ssr-smoke.mjs
node e2e/node-floor-smoke.mjs
node scripts/headless-types-check.mjs
node scripts/public-barrel-check.mjs
node scripts/package-boundary-check.mjs
node scripts/style-vars-check.mjs
node scripts/docs-anchor-check.mjs
node scripts/bundle-table-check.mjs
node scripts/issue-codes-check.mjs
node scripts/indicators-matrix-check.mjs
node scripts/examples-doc-check.mjs
node scripts/repo-url-check.mjs
node scripts/llms-txt-check.mjs
node scripts/gate-parity-check.mjs

# Pack and inspect the actual release artifacts. Consumer installation remains
# an explicit release check (`--consume`) because it needs a fresh install.
node scripts/release-artifact-check.mjs

echo "$tree" > "$(git rev-parse --git-path gate-ok)"
echo "✔ Gate passed — tree ${tree}"
