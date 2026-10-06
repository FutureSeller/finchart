import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  testMatch: "showcase-mobile.spec.ts",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter charts-demo-react exec vite --host 127.0.0.1 --port 5178 --strictPort",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter charts-docs dev --host 127.0.0.1 --port 5179 --strictPort",
      url: "http://127.0.0.1:5179/showcase",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
