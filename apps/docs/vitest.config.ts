import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The last reporter fails `vitest run` when coverage measured nothing —
    // without it the thresholds below pass for free on 0/0 (see the file).
    // Naming reporters replaces vitest's default list, so that list is restated:
    // "default", plus "github-actions" where vitest would have added it itself.
    // (Vitest also swaps "default" for "agent" when it detects an AI agent; that
    // is not restated — it changes how output reads, not what passes.)
    // The path is built from strings, not `new URL()` — in the examples app's
    // jsdom test run that was jsdom's URL and `fileURLToPath` threw on it (the
    // wiring test imports this file).
    reporters: [
      "default",
      ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []),
      join(dirname(fileURLToPath(import.meta.url)), "zero-coverage-reporter.ts"),
    ],
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
