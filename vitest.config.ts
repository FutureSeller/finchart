import { defineConfig } from 'vitest/config';

/**
 * The root run is the packages' own runs — nothing of its own.
 *
 * This file used to carry an `include` of `packages/<pkg>/__tests__/...`, and
 * the tests live at `packages/<pkg>/src/.../__tests__`. So `vitest` from the
 * root matched nothing and died with `No test files found, exiting with code
 * 1` — measured. Not a false green, but a root run nobody could use, and
 * nothing in CI or the gate runs the root, so it sat that way from the first
 * commit.
 *
 * Listing the workspaces instead of re-declaring globs means a root run loads
 * each package's own `vitest.config.ts` — its `include`, its `environment`,
 * core's `.ts`-before-`.js` resolve order. Coverage is the exception: a root
 * run reports different numbers than the package's own (tools: 93.39% here
 * against 95.89% in the package, because the package's `exclude` does not
 * apply), so the thresholds that count are still the per-package runs turbo
 * drives — `pnpm test:coverage`, which is what the gate and CI run.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
