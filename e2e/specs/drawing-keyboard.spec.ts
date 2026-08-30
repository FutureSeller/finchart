import { expect, test } from "@playwright/test";

/**
 * **Does the hand that armed a tool from the toolbar get the keyboard back?**
 *
 * `packages/tools/README.md` sells *"Esc cancels, Delete removes, `]` / `[`
 * cycle the selection"* in the user's own vocabulary. But those keys only
 * arrive **while the chart element has focus** — `@finchart/dom` hangs the
 * listeners and `tabindex` on the element `build()` received. And the one
 * gesture that arms a tool, clicking a toolbar button, **takes exactly that
 * focus away.** All three recipes we sell followed that path, and there were
 * **zero** `.focus()` calls in the entire repository.
 *
 * **Why this isn't a unit test.** `packages/dom`'s vitest runs
 * `environment: 'node'` against a hand-built fake `document`. Imitating focus,
 * `activeElement` and bubbling in there would mean **validating my own browser
 * model against itself** — inviting the failure the header comment in
 * `multi-toolbox.test.ts` diagnosed three rounds running, where *"the mock was
 * narrower than the real thing, so nothing showed"*. The browser's focus rules
 * are themselves the stage for this defect, so it takes real Chromium.
 *
 * **The observation window already exists.** `trading.ts` subscribes to
 * `modeChanges` and updates the buttons' `aria-pressed`, so the tool mode reads
 * straight out of the DOM — no test-only hook gets dug.
 */
test.describe("drawing keyboard — reachable even when armed from the toolbar", () => {
  test("should cancel with Escape right after arming from the toolbar", async ({
    page,
  }) => {
    await page.goto("/trading.html");

    const trend = page.getByRole("button", { name: "Trend line" });
    await trend.click();

    // It's armed — up to here this was always true, focus or no focus.
    await expect(trend).toHaveAttribute("aria-pressed", "true");

    /**
     * Press Esc immediately, **without clicking the chart**. This is the most
     * common way anyone arms a tool and then changes their mind, and before the
     * fix nothing happened here: the keydown leaves the `<button>` and rises to
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
