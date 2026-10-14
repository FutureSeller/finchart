import { expect, test } from "@playwright/test";

/**
 * **Does the hand that armed a tool from the toolbar get the keyboard back?**
 *
 * The drawing keys (Esc, Delete, `]` / `[`) only arrive while the chart
 * element has focus, and clicking a toolbar button to arm a tool takes that
 * focus away. Browser focus rules, `activeElement` and bubbling are the stage
 * for this, and a hand-built fake `document` would only check its own model of
 * them, so it runs in a real browser. `trading.ts` mirrors the tool mode into
 * the buttons' `aria-pressed`, so the test reads it straight from the DOM.
 */
test.describe("drawing keyboard — reachable even when armed from the toolbar", () => {
  test("should cancel with Escape right after arming from the toolbar", async ({
    page,
  }) => {
    await page.goto("/trading.html");

    const trend = page.getByRole("button", { name: "Trend line" });
    await trend.click();

    // It's armed — this holds whether or not focus came back.
    await expect(trend).toHaveAttribute("aria-pressed", "true");

    /**
     * Press Esc immediately, **without clicking the chart**. This is the most
     * common way anyone arms a tool and then changes their mind; unless focus
     * returns to the chart, the keydown leaves the `<button>` and rises to
     * `#toolbar` without ever passing `#chart`'s listeners.
     */
    await page.keyboard.press("Escape");

    await expect(trend).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * It also checks that focus really came back — with the assertion above
   * alone, an app that handled Esc **on the button** would go green too. The
   * contract we sold is *"the chart receives the keys"*, not *"the toolbar
   * imitates Esc"*.
   */
  test("should hand focus back to the element that owns the keys", async ({
    page,
  }) => {
    await page.goto("/trading.html");

    await page.getByRole("button", { name: "Horizontal" }).click();

    const focusedId = await page.evaluate(
      () => document.activeElement?.id ?? "",
    );
    expect(focusedId).toBe("chart");
  });
});
