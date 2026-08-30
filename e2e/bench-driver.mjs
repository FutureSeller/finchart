/**
 * Runs bench.html in a real Chrome and brings the numbers back.
 *
 *   npx vite apps/examples --port 5199 --strictPort   # in another terminal
 *   node apps/examples/bench-driver.mjs time          # frame time
 *   node apps/examples/bench-driver.mjs alloc         # allocation per frame
 *   node apps/examples/bench-driver.mjs heap 0 1 3    # allocation sites (by scenario number)
 *
 * It needs playwright, which is not a repo dependency — install it yourself:
 *   npm i -D playwright && npx playwright install chromium
 *
 * **`time` doesn't need any of this.** The page runs everything itself and puts
 * the result on `window.__bench`, so reading that value is enough — which is
 * what `.claude/skills/run-examples/bench.sh` does through agent-browser. Only
 * `alloc` and `heap`, which need CDP, are left here.
 *
 * **It uses real Chrome (`channel: "chrome"`).** The bundled headless shell
 * rasterizes in software, which makes frame measurements diverge from reality.
 *
 * **Absolute values swing 20~25% between sessions on identical code.** To see
 * whether a change made something better, measure before and after by
 * **alternating within one session**. Subtracting yesterday's number from
 * today's means nothing.
 */
import { chromium } from "playwright";

const URL = process.env.BENCH_URL ?? "http://localhost:5199/bench.html";
const DPR = Number(process.env.BENCH_DPR ?? 2);

const [, , command = "time", ...rest] = process.argv;

async function open({ args = [] } = {}) {
  const browser = await chromium.launch({ channel: "chrome", args });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  return { browser, context, page };
}

/** The frame-time table. Taken as-is from what bench.html ran on its own. */
async function time() {
  const { browser, page } = await open();
  await page.waitForFunction(() => window.__bench !== undefined, null, {
    timeout: 600000,
  });

  const r = await page.evaluate(() => window.__bench);
  const ms = (n) => n.toFixed(2).padStart(7);

  console.log(`\n=== dpr=${r.devicePixelRatio}  ${r.viewport.width}x${r.viewport.height} ===`);
  console.log(`crosshair-only layer floor: ${r.crosshairFloor.perFrameMs.toFixed(3)} ms/frame`);

  /**
   * Pairs come first. **These are the only numbers comparable across
   * sessions.** The absolute table below only means anything within one
   * session.
   */
  if (r.pairs?.length) {
    console.log("\n--- pairs (alternated · only the ratio is trusted) ---\n");
    for (const p of r.pairs) {
      const pct = (p.ratio - 1) * 100;
      const sign = pct >= 0 ? "+" : "";
      const spread = `${((p.ratioRange.min - 1) * 100).toFixed(1)}% ~ ${((p.ratioRange.max - 1) * 100).toFixed(1)}%`;
      console.log(`  ${p.question}`);
      console.log(
        `    ${p.baselineName} ${p.baselineMedian.toFixed(3)}ms  →  ${p.variantName} ${p.variantMedian.toFixed(3)}ms` +
          `   = ${sign}${pct.toFixed(1)}%`,
      );
      console.log(`    spread across ${p.blocks} blocks: ${spread}\n`);
    }
  }

  if (r.coldStart?.length) {
    console.log("--- cold start (up to the first paint · data preparation excluded) ---\n");
    for (const c of r.coldStart) {
      console.log(
        `  ${c.name.padEnd(24)} median ${ms(c.stats.median)}ms   p95 ${ms(c.stats.p95)}ms`,
      );
    }
    console.log();
  }

  console.log("--- absolute values per scenario (comparable within one session only) ---\n");
  console.log("scenario".padEnd(40), " points", " median", "    p95", "    max", "commit%");

  for (const f of r.frames) {
    console.log(
      f.name.padEnd(36),
      String(f.visiblePoints).padStart(6),
      ms(f.total.median),
      ms(f.total.p95),
      ms(f.total.max),
      `${(f.commitShare * 100).toFixed(0)}%`.padStart(7),
    );
  }

  console.log("\nrAF sustained frames:");
  for (const f of r.frameRate) {
    console.log(
      `  ${f.name.padEnd(38)} ${f.fps.toFixed(1)} fps  (interval median ${f.frameInterval.median.toFixed(1)}ms, p95 ${f.frameInterval.p95.toFixed(1)}ms)`,
    );
  }

  await browser.close();
}

/**
 * Allocation per frame.
 *
 * `performance.memory` can't measure it — the value is frozen inside a task,
 * and breaking the task apart didn't move it in this browser either. So V8 is
 * asked directly over CDP. Only increases are summed, so whatever GC already
 * reclaimed is missing → this is a **floor**.
 */
async function alloc() {
  const frames = Number(rest[0] ?? 150);
  const { browser, context, page } = await open();
  await page.waitForFunction(() => window.__harness !== undefined, null, {
    timeout: 600000,
  });

  const names = await page.evaluate(() => window.__scenarios);
  const cdp = await context.newCDPSession(page);
  const used = async () => (await cdp.send("Runtime.getHeapUsage")).usedSize;

  console.log(`\nallocation per frame (${frames} frames, sum of increases = a floor):\n`);

  for (let i = 0; i < names.length; i++) {
    await page.evaluate((n) => window.__harness.prepare(n), i);
    await page.evaluate(() => window.__harness.frames(5));

    let allocated = 0;
    let previous = await used();

    for (let f = 0; f < frames; f++) {
      await page.evaluate(() => window.__harness.frames(1));
      const now = await used();
      if (now > previous) allocated += now - previous;
      previous = now;
    }

    await page.evaluate(() => window.__harness.dispose());
    console.log(
      `  ${names[i].padEnd(38)} ${(allocated / frames / 1024).toFixed(0).padStart(6)} KB/frame`,
    );
  }

  await browser.close();
}

/**
 * Which function the allocation comes from.
 *
 * By default the sampler reports **only what survived**, so samples collected by
 * GC have to be included as well for the garbage thrown away each frame to show
 * up. That does inflate the absolute values, though — measure size with
 * `alloc`, and read only the **proportions** here.
 */
async function heap() {
  const frames = 300;
  const { browser, context, page } = await open();
  await page.waitForFunction(() => window.__harness !== undefined, null, {
    timeout: 600000,
  });

  const names = await page.evaluate(() => window.__scenarios);
  const targets = rest.length ? rest.map(Number) : names.map((_, i) => i);

  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");

  for (const index of targets) {
    // The allocation of standing the chart up stays outside the sampled span.
    await page.evaluate((i) => window.__harness.prepare(i), index);

    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 2048,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await page.evaluate((f) => window.__harness.frames(f), frames);
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    await page.evaluate(() => window.__harness.dispose());

    const bySite = new Map();
    let total = 0;

    const walk = (node) => {
      if (node.selfSize > 0) {
        const { functionName, url, lineNumber } = node.callFrame;
        const file = (url || "").split("/").pop() || "?";
        const key = `${functionName || "(anonymous)"}  ${file}:${lineNumber + 1}`;
        bySite.set(key, (bySite.get(key) ?? 0) + node.selfSize);
        total += node.selfSize;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(profile.head);

    console.log(`\n### ${names[index]}`);
    for (const [site, bytes] of [...bySite.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)) {
      console.log(`  ${((bytes / total) * 100).toFixed(1).padStart(5)}%   ${site}`);
    }
  }

  await browser.close();
}

const commands = { time, alloc, heap };
if (!commands[command]) {
  console.error(`Unknown command: ${command} (time · alloc · heap)`);
  process.exit(1);
}
await commands[command]();
