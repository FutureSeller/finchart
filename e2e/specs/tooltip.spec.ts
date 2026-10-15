import { expect, test } from "@playwright/test";

/**
 * Every tooltip row names its series.
 *
 * Which pane the cursor is in comes from real layout, so the check sweeps a
 * real browser's cursor across every pane rather than probing one pane.
 */

test("every tooltip row names its series, in every pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("bars loaded")).toBeVisible();
  const host = (await page.locator("canvas").first().locator("..").boundingBox())!;
  const tooltip = page.locator("[data-chart-tooltip]");
  const panes = new Set<string>();
  // A sweep down the middle of the chart crosses the price, momentum and volume panes.
  for (let y = host.y + host.height * 0.05; y < host.y + host.height; y += host.height * 0.05) {
    await page.mouse.move(host.x + host.width / 2, y);
    if (!(await tooltip.isVisible())) continue;
    // The first child is the time header; every row after it reads "name: value".
    const rows = (await tooltip.locator(":scope > div").allTextContents()).slice(1);
    for (const row of rows) expect(row).toMatch(/^(● )?[A-Za-z][^:]*: /);
    panes.add(rows.join("|").replace(/[\d.,—-]+/g, ""));
  }
  expect(panes.size).toBeGreaterThanOrEqual(3);
});
