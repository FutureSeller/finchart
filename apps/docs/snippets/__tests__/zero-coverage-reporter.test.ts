/**
 * A coverage threshold with nothing to measure passes for free: an `include`
 * that stops matching gives `Unknown% (0/0)`, a type-only file gives
 * `100% (0/0)`, and either way the run exits 0. Predicting that from the
 * config was tried first and lost to vitest's own matching every round — a
 * `..` segment, `//`, braces, letter case, `#`, the exclusions no config can
 * override. So nothing is predicted: a reporter reads what was **measured** and
 * fails the run when that is zero statements.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import config from "../../vitest.config";
import ZeroCoverageReporter from "../../zero-coverage-reporter";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A child `vitest run` takes a few seconds here; this is the point past which it is hung. */
const CHILD_DEADLINE = 90_000;

/** The slice of istanbul's coverage map the reporter reads. */
const measured = (statements: number) => ({
  getCoverageSummary: () => ({ statements: { total: statements } }),
});

/** One run as vitest drives it: init, coverage, then the end of the run. */
function run(watch: boolean, coverage: unknown) {
  const fail = vi.fn<(message: string) => void>();
  const reporter = new ZeroCoverageReporter({ fail });
  reporter.onInit({ config: { watch } });
  reporter.onCoverage(coverage);
  reporter.onTestRunEnd();
  return fail;
}

describe("zero-coverage reporter", () => {
  it("fails a run that measured nothing", () => {
    expect(run(false, measured(0))).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/measured 0 statements/));
  });

  it("stays out of the way when something was measured", () => {
    expect(run(false, measured(1))).not.toHaveBeenCalled();
  });

  // A watch rerun runs only the tests that changed. If those never touch the
  // target, vitest adds no untested files (`allTestsRun` is false) and the map is
  // empty — legitimately. The guard is for `vitest run`, which scripts and CI use.
  it("lets a watch rerun measure nothing", () => {
    expect(run(true, measured(0))).not.toHaveBeenCalled();
  });

  it("fails closed on a coverage map it cannot read — a guard that cannot look must not pass", () => {
    expect(run(false, {})).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/cannot read the coverage map/));
    expect(run(false, undefined)).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/cannot read the coverage map/));
  });

  // Vitest awaits `onCoverage` before it calls `onTestRunEnd`, and that last hook
  // is what prints a failing test's diff and the GitHub annotations. Throwing from
  // `onCoverage` exits 1 and takes those away — so it must not throw.
  it("never throws from onCoverage — that would cut off the end-of-run report", () => {
    const reporter = new ZeroCoverageReporter({ fail: () => {} });
    reporter.onInit({ config: { watch: false } });
    expect(() => reporter.onCoverage(measured(0))).not.toThrow();
    expect(() => reporter.onCoverage(undefined)).not.toThrow();
  });

  it("is wired into this workspace's reporters by a path that exists, beside the default one", () => {
    const reporters = config.test?.reporters;
    const names = (Array.isArray(reporters) ? reporters : []).flatMap((entry) =>
      typeof entry === "string" ? [entry] : [],
    );
    expect(names).toContain("default");
    const wired = names.filter((name) => name.endsWith("zero-coverage-reporter.ts"));
    expect(wired).toHaveLength(1);
    expect(existsSync(wired[0] ?? "")).toBe(true);
  });

  /** A real `vitest run --coverage` on a throwaway project whose coverage measures nothing. */
  function realRun(testBody: string) {
    // Under node_modules: git ignores it, and `vitest` resolves from there upward.
    const fixture = mkdtempSync(join(appRoot, "node_modules", ".zero-coverage-fixture-"));
    try {
      writeFileSync(
        join(fixture, "fixture.test.ts"),
        `import { expect, it } from "vitest";\nit("fixture", () => { ${testBody} });\n`,
      );
      writeFileSync(
        join(fixture, "vitest.config.ts"),
        [
          'import { defineConfig } from "vitest/config";',
          "export default defineConfig({ test: {",
          '  include: ["fixture.test.ts"], exclude: [],',
          `  reporters: ["default", ${JSON.stringify(join(appRoot, "zero-coverage-reporter.ts"))}],`,
          '  coverage: { provider: "v8", reporter: ["text"], include: ["no-such-target.ts"] },',
          "} });",
        ].join("\n"),
      );
      // The worker's own VITEST_* variables would make the child think it is a worker,
      // and NODE_V8_COVERAGE would have it write coverage for someone else's run.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST") && name !== "NODE_V8_COVERAGE"),
      );
      // **The child carries its own deadline.** `spawnSync` blocks, so the `it`
      // timeout around it cannot fire until it returns — a hung child would hold
      // the worker forever and the `finally` below would never clean up.
      const child = spawnSync(
        process.execPath,
        [join(appRoot, "node_modules", "vitest", "vitest.mjs"), "run", "--root", fixture, "--coverage"],
        { cwd: appRoot, env, encoding: "utf8", timeout: CHILD_DEADLINE, killSignal: "SIGKILL" },
      );
      if (child.error !== undefined || child.signal !== null) {
        throw new Error(
          `the child vitest did not finish — ${child.error?.message ?? `killed by ${child.signal}`} ` +
            `(deadline ${CHILD_DEADLINE}ms)\n${child.stdout}${child.stderr}`,
        );
      }
      return { status: child.status, output: `${child.stdout}${child.stderr}` };
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }

  // Every test passes and nothing was measured — the run is green in every way
  // but this one, so exit code 1 here can only be the guard's.
  it("turns an otherwise green run red when coverage is empty", { timeout: 120_000 }, () => {
    const { status, output } = realRun("expect(1).toBe(1);");
    expect(output).toContain("measured 0 statements");
    expect(status).toBe(1);
  });

  // A test that fails **and** coverage that measures nothing: the run must still
  // show the failing assertion's two values — throwing from `onCoverage` lost them.
  it("keeps a failing test's diagnostics when coverage is empty as well", { timeout: 120_000 }, () => {
    const { status, output } = realRun('expect("left-value").toBe("right-value");');
    expect(status).toBe(1);
    expect(output).toContain("measured 0 statements");
    expect(output).toContain("left-value");
    expect(output).toContain("right-value");
  });
});
