import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["lib/public-market-data.ts", "lib/toss-auth.ts", "app/api/*/route.ts"],
    },
  },
});
