/**
 * Return to live ⏩ — animation is a consumption pattern.
 *
 * The core has no transitions. A consumer that owns a rAF (this one) restates
 * the state through `setVisibleRange` every frame, and `scrollToRealTime` lands
 * the final frame exactly. The visible range is read from what
 * `onXDomainChange` pushed up into React state — declarative and imperative
 * meeting in one button.
 */
import type { Plot, XDomainChangePayload } from "@finchart/core";
import { useEffect, useRef, type RefObject } from "react";
import { ICONS } from "./icons";

export function LiveReturn({
  plot,
  stageRef,
  domain,
}: {
  /** The window's anchor — slot 0's chart. A sync group has one window. */
  plot: Plot | null;
  stageRef: RefObject<HTMLElement | null>;
  domain: XDomainChangePayload | null;
}) {
  const frame = useRef<number | null>(null);
  const cancelScroll = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  // The yield rule — a hand arriving mid-animation kills it that frame.
  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;

    host.addEventListener("pointerdown", cancelScroll, { capture: true });
    host.addEventListener("wheel", cancelScroll, { capture: true });
    return () => {
      cancelScroll();
      host.removeEventListener("pointerdown", cancelScroll, { capture: true });
      host.removeEventListener("wheel", cancelScroll, { capture: true });
    };
  }, [stageRef]);

  const view =
    domain && domain.dataRange
      ? { startX: domain.startX, endX: domain.endX, liveX: domain.dataRange.max }
      : null;
  // Hidden while the live bar is inside the right edge. Both the past and the
  // deep future (the pan-bounds boundary) need a way back.
  const hidden = !view || (view.endX >= view.liveX && view.startX < view.liveX);

  const returnToLive = () => {
    if (!plot) return;

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
        frame.current = null;
        plot.scrollToRealTime();
        return;
      }
      const eased = 1 - (1 - t) ** 3;
      const end = from + (target - from) * eased;
      plot.setVisibleRange(end - span, end);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  return (
    <button
      type="button"
      id="to-live"
      hidden={hidden}
      title="Go live (keeps the zoom)"
      aria-label="Go live"
      onClick={returnToLive}
      dangerouslySetInnerHTML={{ __html: ICONS.live }}
    />
  );
}
