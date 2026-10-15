import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the recipes whose correctness a reader copies are run — the rest
    // of the snippets are held to the type-check.
    include: ["snippets/**/__tests__/**/*.test.ts"],
    // The snippets are examples, not a library: no coverage floor is set.
    coverage: {
      provider: "v8",
      reporter: ["text"],
    },
  },
});
