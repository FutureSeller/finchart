import { defineConfig } from 'vitest/config';

export default defineConfig({
  /** Let .ts beat .js — the reasoning is written down in core's copy of this config. */
  resolve: {
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/index.ts', 'src/**/*.d.ts', 'src/**/__tests__/**'],
      /**
       * A floor that only stops backsliding. `functions` is 70 alone because it
       * sits at 73% today and the wrapper is on a hold-steady policy — no work
       * is scheduled to raise it. This catches a core change eating into the
       * wrapper, nothing more.
       */
      thresholds: {
        branches: 80,
        functions: 70,
        lines: 80,
        statements: 80,
      },
    },
  },
});
