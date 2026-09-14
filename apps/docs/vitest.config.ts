import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the recipes whose correctness a reader copies are run — the rest
    // of the snippets are held to the type-check.
    include: ["snippets/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["snippets/session-of-date.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
