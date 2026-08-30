/**
 * Return to live ⏩ — animation is a consumption pattern.
 *
 * The core has no transitions. Here, a consumer that owns a rAF restates the
 * state through `setVisibleRange` every frame, and `scrollToRealTime` lands the
 * final frame exactly (`rightOffset` is in domain units, which only the core
 * knows).
 */
import type { Plot } from "@finchart/core";
import { ICONS } from "./icons";

export function installLiveReturn(plot: Plot, chartHost: HTMLElement): void {
  const stageEl = document.getElementById("stage")!;
  const liveButton = document.createElement("button");
  liveButton.id = "to-live";
  liveButton.innerHTML = ICONS.live;
  liveButton.title = "Go live (keeps the zoom)";
  liveButton.setAttribute("aria-label", "Go live");
  liveButton.hidden = true;
  stageEl.appendChild(liveButton);

  let view: { startX: number; endX: number; liveX: number } | null = null;

  plot.on("xDomainChange", ({ startX, endX, dataRange }) => {
    if (!dataRange) return;
    view = { startX, endX, liveX: dataRange.max };
    // Hidden while the live bar is inside the right edge. Both the past (the
    // bar is past the right edge) and the deep future (the bar barely clings to
    // the left edge — the pan-bounds boundary) need a way back.
    liveButton.hidden = endX >= dataRange.max && startX < dataRange.max;
  });

  let scrollFrame: number | null = null;
  const cancelScroll = () => {
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };
  // The yield rule — a hand arriving mid-animation kills it that frame.
  chartHost.addEventListener("pointerdown", cancelScroll, { capture: true });
  chartHost.addEventListener("wheel", cancelScroll, { capture: true });

  liveButton.addEventListener("click", () => {
    cancelScroll();
    if (!view || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      plot.scrollToRealTime(); // the demotion rule — jump, with no animation
      return;
    }

    const from = view.endX;
    const span = view.endX - view.startX;
    const target = view.liveX;
    const started = performance.now();
    const DURATION = 280;

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      if (t >= 1) {
        scrollFrame = null;
        plot.scrollToRealTime();
        return;
      }
      const eased = 1 - (1 - t) ** 3;
      const end = from + (target - from) * eased;
      plot.setVisibleRange(end - span, end);
      scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  });
}
