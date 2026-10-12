import { expect, test } from "@playwright/test";

/**
 * The first frame of an `autoSize` chart is drawn at its container's size.
 *
 * Waiting for the first `ResizeObserver` callback is too late: it arrives
 * after the frame callbacks, and a browser can paint the first frame at the
 * size the chart was built with. So the canvas is read right after the frame
 * callback that first draws on it, before any `ResizeObserver` callback could
 * fit it. An engine whose first ink lands after the observer's fit can't tell
 * the difference; on each run at least one of the others could.
 */
test("the first frame is drawn at the container's size", async ({ page }) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    let done = false;
    const check = () => {
      const canvas = document.querySelector("canvas");
      const host = canvas?.parentElement;
      const context = canvas?.getContext("2d");
      if (!canvas || !host || !context || canvas.width === 0) return;
      const ink = context
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0);
      if (!ink) return;
      done = true;
      // The canvas fills the content box: the client box less padding.
      const style = getComputedStyle(host);
      const px = Number.parseFloat;
      Object.assign(document.documentElement.dataset, {
        drawnWidth: canvas.style.width,
        drawnHeight: canvas.style.height,
        hostWidth: String(host.clientWidth - px(style.paddingLeft) - px(style.paddingRight)),
        hostHeight: String(host.clientHeight - px(style.paddingTop) - px(style.paddingBottom)),
      });
    };
    window.requestAnimationFrame = (callback) =>
      request((time) => {
        callback(time);
        if (!done) check();
      });
  });

  // The README example: its data is there from the start, and `<ChartContainer>` gets no size.
  await page.goto("/minimal.html");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-drawn-width");

  const read = async (name: string) => Number.parseFloat((await root.getAttribute(name)) ?? "");
  const [drawnWidth, drawnHeight, hostWidth, hostHeight] = await Promise.all(
    ["data-drawn-width", "data-drawn-height", "data-host-width", "data-host-height"].map(read),
  );
  // Within a pixel: the fit rounds the container's size, which a fractional width can put 1px off clientWidth.
  expect(Math.abs(drawnWidth - hostWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawnHeight - hostHeight)).toBeLessThanOrEqual(1);

  // And against the observer's own figure, not just the formula the library shares with this test.
  const observed = await page.locator("canvas").evaluate(
    (canvas) =>
      new Promise<number[]>((resolve) => {
        const host = canvas.parentElement;
        if (!host) return resolve([]);
        const observer = new ResizeObserver(([entry]) => {
          observer.disconnect();
          resolve([Math.round(entry.contentRect.width), Math.round(entry.contentRect.height)]);
        });
        observer.observe(host);
      }),
  );
  const [observedWidth, observedHeight] = observed;
  expect(Math.abs(drawnWidth - observedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawnHeight - observedHeight)).toBeLessThanOrEqual(1);
});
