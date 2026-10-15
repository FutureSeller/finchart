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
    expect(stage!.height).toBeGreaterThanOrEqual(844 * 0.7);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    await expect(page.locator("[data-chart-legend]")).toBeAttached();
    const { symbolBottom, legendTop, legendRight } = await page.evaluate(() => {
      const symbol = document.querySelector(".chart-symbol")!.getBoundingClientRect();
      const legend = document.querySelector("[data-chart-legend]")!.getBoundingClientRect();
      return { symbolBottom: symbol.bottom, legendTop: legend.top, legendRight: legend.right };
    });
    expect(legendTop).toBeGreaterThanOrEqual(symbolBottom);
    expect(legendRight).toBeLessThanOrEqual(width);

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
      // One snapshot: rects read one call at a time can straddle a scroll or reflow and look overlapped.
      const boxes = await page.locator(".chart-cell").evaluateAll((elements) =>
        elements.map((element) => {
          const { top, bottom, width, height } = element.getBoundingClientRect();
          return { top, bottom, width, height };
        }),
      );
      let previousBottom = 0;
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(width - 2);
        expect(box.height).toBeGreaterThanOrEqual(320);
        expect(box.top).toBeGreaterThanOrEqual(previousBottom);
        previousBottom = box.bottom;
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
      const last = page.locator(".chart-cell").last();
      await last.locator(".chart-symbol").scrollIntoViewIfNeeded();
      await last.locator(".chart-symbol").focus();
      await expect(last).toHaveAttribute("data-focused", "true");
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
  const [first, second, third] = await page.locator(".chart-cell").evaluateAll((elements) =>
    elements.map((element) => {
      const { left, top } = element.getBoundingClientRect();
      return { left, top };
    }),
  );
  expect(second!.left).toBeGreaterThan(first!.left);
  expect(second!.top).toBe(first!.top);
  expect(third!.top).toBeGreaterThan(first!.top);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#controls")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#layouts").getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-cell")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("the legend clears the symbol picker on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:5178");
  await expect(page.locator("#ohlc")).toContainText("O ");
  for (const layout of [1, 4]) {
    await page.locator("#layouts").getByRole("button", { name: String(layout), exact: true }).click();
    await expect(page.locator(".chart-cell [data-chart-legend]")).toHaveCount(layout);
    // Polled: a new cell's legend is placed before its first frame lays the pane out, and moves to its
    // place on that frame.
    await expect
      .poll(() =>
        page.locator(".chart-cell").evaluateAll((elements) =>
          Math.min(
            ...elements.map(
              (element) =>
                element.querySelector("[data-chart-legend]")!.getBoundingClientRect().top -
                element.querySelector(".chart-symbol")!.getBoundingClientRect().bottom,
            ),
          ),
        ),
      )
      .toBeGreaterThanOrEqual(0);
  }
});

test("every tooltip row names its series with Bollinger Bands on", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:5178");
  await expect(page.locator("#ohlc")).toContainText("O ");
  await page.getByRole("button", { name: "BOLL", exact: true }).click();
  await expect(page.getByRole("button", { name: "BOLL", exact: true })).toHaveAttribute("aria-pressed", "true");
  const cell = (await page.locator(".chart-cell").first().boundingBox())!;
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 3);
  const tooltip = page.locator("[data-chart-tooltip]");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("BOLL");
  // The first child is the time header; every row after it reads "name: value".
  const rows = await tooltip.locator(":scope > div").allTextContents();
  for (const row of rows.slice(1)) expect(row).toMatch(/^(● )?[A-Za-z][^:]*: /);
});

test("live updates do not replace the icon buttons' contents", async ({ page }) => {
  await page.goto("http://127.0.0.1:5178");
  await expect(page.locator("#ohlc")).toContainText("O ");
  // A browser may send no click when the pressed node is swapped out before the release. The desktop
  // rail is enough: the mobile one in Settings renders the same buttons.
  const { buttons, connected, ticks, swaps } = await page.evaluate(
    () =>
      new Promise<{ buttons: number; connected: boolean; ticks: number; swaps: number }>((resolve) => {
        let ticks = 0;
        let swaps = 0;
        const tickObserver = new MutationObserver(() => (ticks += 1));
        tickObserver.observe(document.querySelector("#ohlc")!, { childList: true, subtree: true, characterData: true });
        const swapObserver = new MutationObserver((records) => (swaps += records.length));
        const targets = document.querySelectorAll("#rail button, #to-live");
        for (const button of targets) swapObserver.observe(button, { childList: true, subtree: true });
        setTimeout(() => {
          tickObserver.disconnect();
          swapObserver.disconnect();
          const connected = [...targets].every((button) => button.isConnected);
          resolve({ buttons: targets.length, connected, ticks, swaps });
        }, 2000);
      }),
  );
  expect(buttons).toBe(7);
  expect(connected).toBe(true);
  expect(ticks).toBeGreaterThan(0);
  expect(swaps).toBe(0);
});
