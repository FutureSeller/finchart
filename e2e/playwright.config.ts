import { defineConfig, devices } from "@playwright/test";

/**
 * The real-canvas smoke test — it sees the one thing jsdom plus a fake renderer
 * cannot: whether a real 2D context painted real pixels.
 *
 * Visual regressions are measured as **properties of the pixels** rather than
 * as golden bytes (does a color exist, did the painted amount go up or down,
 * what changed between hover and no hover). A golden PNG breaks on platform
 * fonts, so local (macOS) and CI (linux) contradict each other — a property
 * assertion is the same everywhere.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  use: {
    // A dev server that reads `dist` — `turbo build` has to run first.
    baseURL: "http://localhost:5177",
  },
  webServer: {
    // The stage is the examples app — the filter starts vite from that root.
    command: "pnpm --filter charts-examples exec vite --port 5177 --strictPort",
    url: "http://localhost:5177",
    reuseExistingServer: !process.env.CI,
  },
});
