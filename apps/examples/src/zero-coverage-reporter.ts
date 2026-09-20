/**
 * Fails the run when coverage measured nothing.
 *
 * A threshold with nothing to measure passes for free. When `coverage.include`
 * stops matching — the file it names was renamed along with its test, say —
 * the coverage map is empty, every percentage stays the string `"Unknown"`,
 * and vitest's check `"Unknown" < 80` is false. A file with no executable
 * statements (types only) reports `100% (0/0)`. Either way the run exits 0 and
 * the 80% floor guards nothing, and vitest has no option that fails it.
 *
 * **This reads the outcome instead of predicting it.** Asserting at config
 * load that `include` names a real file was tried first and lost to vitest's
 * own matching in every review round: it matches patterns as strings against
 * normalized absolute filenames (`..`, `//`, braces and letter case all
 * resolve on disk and match nothing there), cuts filenames at `#`, and appends
 * exclusions no config can override — tests, config files, setup files. Each
 * was measured with the assertion green and the report at 0/0. `onCoverage`
 * runs after all of that, on what was actually measured, and a CLI override of
 * `include` does not get past it either.
 *
 * **Only `vitest run` is held to it.** A watch rerun runs the tests that
 * changed; if those never touch the target, vitest adds no untested files and
 * the map is empty, legitimately. `vitest.config.watch` is vitest's own answer
 * to "is this a watch session" — guessing it from argv or the TTY would be one
 * more thing re-implemented.
 *
 * **What this does not cover.** It guards this workspace's own
 * `vitest run --coverage`, which is what `pnpm test:coverage` drives.
 * `--reporter=…` on the command line replaces the reporter list and drops it;
 * a root `vitest` projects run uses the root's reporters, not this
 * workspace's. `vitest run --changed --coverage` can measure nothing
 * legitimately (the target did not change) and this fails it — an incremental
 * run needs its own rule. And measuring something is not measuring the *right*
 * thing: another file that matches `include` would satisfy it.
 *
 * The other app keeps its own copy — sharing it means a workspace package,
 * which is more than these lines are worth today.
 */
import type { Reporter } from "vitest/node";

interface MeasuredCoverage {
  getCoverageSummary(): { statements: { total: number } };
}

/** `onCoverage` hands over `unknown`; this is the one method of istanbul's CoverageMap read here. */
function isMeasuredCoverage(value: unknown): value is MeasuredCoverage {
  return (
    typeof value === "object" &&
    value !== null &&
    "getCoverageSummary" in value &&
    typeof value.getCoverageSummary === "function"
  );
}

/** How a failed guard ends the run: say why, and leave exit code 1 for vitest to exit with. */
function failRun(message: string): void {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
}

export default class ZeroCoverageReporter implements Reporter {
  private watch = false;
  private failure: string | null = null;

  constructor(private readonly options: { fail?: (message: string) => void } = {}) {}

  onInit(vitest: { config: { watch: boolean } }): void {
    this.watch = vitest.config.watch;
  }

  /**
   * **Records, never throws.** Vitest awaits this hook before it calls
   * `onTestRunEnd`, and that last hook is what prints a failing test's diff and
   * the GitHub Actions annotations. Throwing here exits 1 and takes those away
   * — measured: with a failing assertion and an empty map, the assertion's
   * details were gone. The verdict waits for the end of the run.
   */
  onCoverage(coverage: unknown): void {
    if (this.watch) return;
    if (!isMeasuredCoverage(coverage)) {
      this.failure =
        "zero-coverage reporter cannot read the coverage map vitest handed over — " +
        "a guard that cannot look must not pass";
      return;
    }
    this.failure =
      coverage.getCoverageSummary().statements.total === 0
        ? "coverage measured 0 statements — the thresholds would pass for free. " +
          "Does coverage.include still name a file with code in it?"
        : null;
  }

  onTestRunEnd(): void {
    if (this.failure === null) return;
    const message = this.failure;
    this.failure = null;
    (this.options.fail ?? failRun)(message);
  }
}
