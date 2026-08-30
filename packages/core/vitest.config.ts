import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * Look for .ts ahead of .js.
   *
   * Vite's default is `.mjs .js .mts .ts …`, so **a .js sitting next to the
   * source wins.** Running tsc without --noEmit, or an IDE with automatic
   * compilation on, produces exactly those files — and then the tests don't
   * fail, they **quietly run old code.**
   *
   * `noEmit` in the root tsconfig stops the causes on our side but can't reach
   * an IDE's settings. Reversing the order makes a leftover harmless — making
   * it not matter is surer than preventing it.
   * (esbuild looks at .ts first anyway, so the tsup build is already safe.)
   */
  resolve: {
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.d.ts', 'src/**/__tests__/**'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
