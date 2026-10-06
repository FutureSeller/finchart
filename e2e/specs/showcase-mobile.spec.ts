import { expect, test } from "@playwright/test";

for (const width of [320, 390, 492, 768]) {
  test(`standalone showcase fits ${width}px and keeps controls reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("http://127.0.0.1:5178");
    await expect(page.locator("#ohlc")).toContainText("O ");
    await expect(page.locator("#controls")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const stage = await page.locator("#stage").boundingBox();
    expect(stage!.width).toBeGreaterThanOrEqual(width - 2);
    expect(stage!.height).toBeGreaterThanOrEqual(320);
    expect(stage!.height).toBeGreaterThanOrEqual(844 * 0.7);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    const symbol = await page.locator(".chart-symbol").boundingBox();
    const legend = await page.locator("[data-chart-legend]").boundingBox();
    expect(legend!.y).toBeGreaterThanOrEqual(symbol!.y + symbol!.height);
    expect(legend!.x + legend!.width).toBeLessThanOrEqual(width);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#controls")).toBeVisible();
    expect((await page.locator("#stage").boundingBox())!.height).toBe(stage!.height);
    for (const selector of ["#timeframes button", "#rail button", ".chart-symbol"]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "15m", exact: true }).click();
    await expect(page.getByRole("button", { name: "15m", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.locator("body")).toHaveClass("light");
    await page.getByRole("button", { name: "Magnet", exact: false }).click();
    await expect(page.getByRole("button", { name: "Magnet", exact: false })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#controls")).toBeHidden();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();

    for (const layout of [2, 4]) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.locator("#layouts").getByRole("button", { name: String(layout), exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.locator(".chart-cell")).toHaveCount(layout);
      const cells = await page.locator(".chart-cell").all();
      let previousBottom = 0;
      for (const cell of cells) {
        const box = await cell.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(width - 2);
        expect(box!.height).toBeGreaterThanOrEqual(320);
        expect(box!.y).toBeGreaterThanOrEqual(previousBottom);
        previousBottom = box!.y + box!.height;
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
      await cells.at(-1)!.locator(".chart-symbol").scrollIntoViewIfNeeded();
      await cells.at(-1)!.locator(".chart-symbol").focus();
      await expect(cells.at(-1)!).toHaveAttribute("data-focused", "true");
    }
  });
}

test("docs embeds a usable mobile showcase without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5179/showcase");
  await page.getByRole("button", { name: "Run React trading showcase" }).click();
  const demo = page.frameLocator(".showcase-frame");
  await expect(demo.locator("#ohlc")).toContainText("O ");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const frame = await page.locator(".showcase-frame").boundingBox();
  const stage = await demo.locator("#stage").boundingBox();
  expect(stage!.width).toBeGreaterThanOrEqual(frame!.width - 4);
  expect(stage!.height).toBeGreaterThanOrEqual(320);
  await expect(demo.locator("#controls")).toBeHidden();
  await demo.getByRole("button", { name: "Settings", exact: true }).click();
  await demo.getByRole("button", { name: "RSI", exact: true }).click();
  await expect(demo.getByRole("button", { name: "RSI", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("resizing retains settings and restores the desktop panel grid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5178");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#layouts").getByRole("button", { name: "4", exact: true }).click();
  await expect(page.locator(".chart-cell")).toHaveCount(4);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeHidden();
  await expect(page.locator("#controls")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  const cells = await page.locator(".chart-cell").all();
  const first = await cells[0].boundingBox();
  const second = await cells[1].boundingBox();
  const third = await cells[2].boundingBox();
  expect(second!.x).toBeGreaterThan(first!.x);
  expect(second!.y).toBe(first!.y);
  expect(third!.y).toBeGreaterThan(first!.y);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#controls")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#layouts").getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-cell")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
