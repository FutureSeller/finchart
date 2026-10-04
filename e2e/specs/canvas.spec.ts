import { expect, test, type Page } from "@playwright/test";

/**
 * Asserts on the pixels of a real canvas.
 *
 * The command-list tests only see "what was it told to draw" — this file sees
 * whether those commands became real pixels in a real 2D context. An empty
 * canvas passes every command test and is still nothing to the user.
 */

interface PixelStats {
  painted: number;
  colors: number;
  /** An rgb string → a pixel count. Only the colors asked for are counted. */
  matches: Record<string, number>;
}

/** Pixel statistics for the data canvas. Colors are counted by exact "r,g,b" match, for body fills. */
async function pixelStats(page: Page, wanted: string[] = []): Promise<PixelStats> {
  return page.evaluate((wantedColors) => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    const matches: Record<string, number> = {};
    for (const color of wantedColors) matches[color] = 0;

    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      painted += 1;
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (key in matches) matches[key] += 1;
    }

    return { painted, colors: seen.size, matches };
  }, wanted);
}

const UP = "22,163,74"; // #16a34a — DEFAULT_CANDLE_STYLE.up
const DOWN = "220,38,38"; // #dc2626 — DEFAULT_CANDLE_STYLE.down

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("bars loaded")).toBeVisible();
  // The first frame arrives on a rAF — give it a moment to get painted.
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    return context
      .getImageData(0, 0, canvas.width, canvas.height)
      .data.some((value, index) => index % 4 === 3 && value > 0);
  });
});

test("both candle colors are painted as real pixels", async ({ page }) => {
  const stats = await pixelStats(page, [UP, DOWN]);

  // Screens out an empty or single-color canvas — a picture is thousands of pixels in many colors.
  expect(stats.painted).toBeGreaterThan(5_000);
  expect(stats.colors).toBeGreaterThan(3);
  expect(stats.matches[UP]).toBeGreaterThan(100);
  expect(stats.matches[DOWN]).toBeGreaterThan(100);
});

test("the crosshair only adds pixels on hover", async ({ page }) => {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");

  const before = await pixelStats(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForTimeout(100); // one rAF frame
  const hovered = await pixelStats(page);

  // A crosshair crossing the panes has to increase the painted pixel count.
  expect(hovered.painted).toBeGreaterThan(before.painted);
});

test("turning the grid off reduces the painted pixels", async ({ page }) => {
  const before = await pixelStats(page);

  await page.getByLabel("Grid").uncheck();
  await page.waitForTimeout(100);
  const without = await pixelStats(page);

  expect(without.painted).toBeLessThan(before.painted);
  // The series stays — the candle colors have to still be there.
  const colors = await pixelStats(page, [UP, DOWN]);
  expect(colors.matches[UP]).toBeGreaterThan(100);
});

test("the trading screen has real pixels too", async ({ page }) => {
  await page.goto("/trading.html");
  await expect(page.locator("#status")).toContainText("BTC/KRW");
  await page.waitForTimeout(300);

  const stats = await pixelStats(page, [UP, DOWN]);
  expect(stats.painted).toBeGreaterThan(5_000);
});

test("the downloaded PNG includes DOM axis labels", async ({ page }) => {
  await page.goto("/trading.html");
  await expect(page.locator("[data-chart-axis] span").first()).toBeVisible();
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function () {
      (window as unknown as { chartShot?: string }).chartShot = this.href;
    };
  });
  await page.getByRole("button", { name: "PNG" }).click();

  const changedPixels = await page.evaluate(async () => {
    const url = (window as unknown as { chartShot?: string }).chartShot;
    const canvas = document.querySelector("#chart canvas") ?? document.querySelector("canvas");
    if (!url || !(canvas instanceof HTMLCanvasElement)) throw new Error("screenshot fixture missing");
    const image = new Image();
    image.src = url;
    await image.decode();
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    const source = canvas.getContext("2d");
    if (!context || !source) throw new Error("screenshot context missing");
    context.drawImage(image, 0, 0);
    const before = source.getImageData(0, 0, canvas.width, canvas.height).data;
    const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) changed++;
    }
    return changed;
  });
  expect(changedPixels).toBeGreaterThan(10);
});

test("the trading screen exposes exact candle data in a navigable table", async ({ page }) => {
  await page.goto("/trading.html");
  const disclosure = page.locator("[data-chart-data]");
  await expect(disclosure.locator("summary")).toContainText("BTC/KRW 5-minute candles");
  await disclosure.locator("summary").click();
  await expect(disclosure.getByRole("table", { name: "BTC/KRW 5-minute candles" })).toBeVisible();
  await expect(disclosure.getByRole("columnheader")).toHaveCount(6);
  await expect(disclosure.locator("tbody tr")).toHaveCount(100);
  await page.locator("#toolbar select").first().selectOption("ETH/KRW");
  await expect(page.locator("#chart")).toHaveAttribute("aria-label", /ETH\/KRW/);
  await expect(disclosure.getByRole("table", { name: "ETH/KRW 5-minute candles" })).toBeVisible();
});

/**
 * **Does a hostile style value get painted in a neighbor's color?**
 *
 * This group is here for the same reason the file is. What `applyColor`,
 * `usableWidth` and `applyFont` decide on is *"did the assignment take on the
 * canvas"* — and **vitest's fake context accepts anything as-is** (the setter
 * in `dom-fakes.ts` is `state[name] = value`). So the rejection branches are
 * **unreachable** from a unit test, and defects turned up in exactly that spot
 * three rounds running.
 *
 * Only real Chromium actually rejects an invalid value. This is its only home.
 */
test.describe("hostile style values (zero trust)", () => {
  /**
   * Sets CSS variables on the container and **actually forces a redraw.**
   *
   * A mutation test caught this: an earlier version of this helper set the
   * variables and waited two rAFs, but **a canvas only redraws when something
   * invalidates it.** Assigning a CSS variable is not an invalidation — the
   * theming guide says so itself, in *"it takes effect on the next render —
   * which is why `requestRender()` exists"*. So all four assertions were
   * **measuring a frozen picture**, and reverting the guards wholesale left
   * them green. The file built to hold the guards was holding nothing.
   *
   * Toggling the grid checkbox off and on **redraws** the chart in its original
   * state — an invalidation handle the example already has, so no test-only
   * back door is dug.
   */
  const rerender = async (page: Page) => {
    await page.getByLabel("Grid").uncheck();
    await page.getByLabel("Grid").check();
    await page.waitForTimeout(100);
  };

  const restyle = async (page: Page, css: Record<string, string>) => {
    await page.evaluate((vars) => {
      const host =
        document.querySelector<HTMLElement>("[data-chart], .chart, #chart") ??
        document.querySelector("canvas")?.parentElement;
      if (!host) throw new Error("chart container not found");
      for (const [name, value] of Object.entries(vars)) {
        host.style.setProperty(name, value);
      }
    }, css);
    await rerender(page);
  };

  /**
   * **Is the harness alive?** This proves the other four assertions in this
   * file are not measuring a frozen picture. Set a valid value and the pixels
   * have to **actually change**.
   *
   * Without this control, all four sat quietly dead. When the control goes red
   * it does not mean "a guard broke" — it means "the invalidation handle is
   * gone".
   */
  test("control: a valid value really does change the pixels", async ({ page }) => {
    const MAGENTA = "255,0,255";
    const before = await pixelStats(page, [MAGENTA]);

    await restyle(page, { "--chart-grid": "#ff00ff" });
    const after = await pixelStats(page, [MAGENTA]);

    expect(after.matches[MAGENTA] - before.matches[MAGENTA]).toBeGreaterThan(1_000);
  });

  /**
   * **The central assertion**: an invalid candle color must not leave that spot
   * **painted in some other element's color.** Measured once, the candles came
   * out in the axis label's gray — not the fallback, not unpainted, but the
   * neighbor's color.
   *
   * Two things are measured. The up candles **disappear** (the guard demotes
   * them to transparent), and the total ink **drops by that much** (painting in
   * a neighbor's color would leave the total unchanged — disabling the guard
   * and measuring gave exactly "unchanged").
   */
  test("an invalid color does not inherit its neighbor's", async ({ page }) => {
    const before = await pixelStats(page, [UP]);
    expect(before.matches[UP]).toBeGreaterThan(100);

    await restyle(page, { "--chart-candle-up": "nope" });
    const after = await pixelStats(page, [UP]);

    // Antialiasing and unrelated strokes can leave a few exact green pixels
    // in WebKit; the candle bodies themselves must disappear.
    expect(after.matches[UP]).toBeLessThan(before.matches[UP] / 5);
    // Ink drops by what wasn't drawn. Painted in somebody else's color, the total would hold.
    expect(after.painted).toBeLessThan(before.painted - before.matches[UP] / 2);
  });

  /**
   * `light-dark()` is valid CSS. Chromium and WebKit reject it on canvas and
   * demote it to transparent; Firefox accepts it as a real color. Either way,
   * the old green must not be inherited from the preceding command.
   */
  test("valid CSS the canvas can't read does not inherit a neighbor either", async ({ page }) => {
    const DARK = "17,17,17";
    const LIGHT = "238,238,238";
    const before = await pixelStats(page, [UP, DARK, LIGHT]);
    await restyle(page, { "--chart-candle-up": "light-dark(#111111, #eeeeee)" });
    const after = await pixelStats(page, [UP, DARK, LIGHT]);

    expect(after.matches[UP]).toBeLessThan(before.matches[UP] / 5);
    const acceptedColor =
      after.matches[DARK] + after.matches[LIGHT] - before.matches[DARK] - before.matches[LIGHT];
    const demoted = after.painted < before.painted - before.matches[UP] / 2;
    expect(demoted || acceptedColor > 100).toBe(true);
  });

  /**
   * A consumer trying to turn the grid off with `--chart-grid-width: 0`. The
   * canvas used to ignore the 0 and draw **at the previous line's width** —
   * with the guard disabled, the ink went **up**, 75886 → 77300. So the `<`
   * bites in exactly that direction.
   */
  test("a width of 0 does not inherit the previous width", async ({ page }) => {
    const before = await pixelStats(page);
    await restyle(page, { "--chart-grid-width": "0" });
    const after = await pixelStats(page);

    expect(after.painted).toBeLessThan(before.painted);
  });

  /**
   * `--chart-label-font-size: 12` (the unit is missing) becomes
   * `"12 system-ui"`, which the canvas rejects. Text used to be drawn **in the
   * previous command's font**.
   *
   * The axis labels on this chart are DOM, so canvas text is only about 1% of
   * the total ink — which made a threshold like `before * 1.5` fifty times too
   * loose. **So a scale is measured first with a valid value**: how far 40px
   * moves the ink, and then the assertion is that the invalid value doesn't get
   * even halfway. Without the guard, the invalid value inherits the previous
   * 40px and travels the full scale.
   *
   * It measures **magnitude, not direction** — in practice 40px **reduces** the
   * ink by 639 (bigger text means labels that overlap and get dropped).
   * Inheriting travels the full scale in either direction, so the absolute
   * value is the right ruler.
   */
  test("an invalid font does not draw text at a neighbor's size", async ({ page }) => {
    const base = await pixelStats(page);

    await restyle(page, { "--chart-label-font-size": "40px" });
    const big = await pixelStats(page);
    const scale = Math.abs(big.painted - base.painted);
    // If the scale itself is dead, the assertion below means nothing.
    expect(scale).toBeGreaterThan(100);

    await restyle(page, { "--chart-label-font-size": "12" });
    const bad = await pixelStats(page);

    expect(Math.abs(bad.painted - base.painted)).toBeLessThan(scale / 2);
  });
});
