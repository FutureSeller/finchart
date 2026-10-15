import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts"],
    // The examples are demos, not a library: their tests check the logic a
    // demo leans on, and no coverage floor is set.
    coverage: {
      provider: "v8",
      reporter: ["text"],
    },
  },
});
