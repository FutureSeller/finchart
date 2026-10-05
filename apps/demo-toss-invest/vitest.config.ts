import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts", "hooks/__tests__/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "lib/public-market-data.ts", "lib/toss-auth.ts", "lib/candle-client.ts",
        "hooks/use-market-data.ts", "hooks/use-chart-session.ts", "app/api/*/route.ts",
      ],
    },
  },
});
