/**
 * The value axis's rules, written over a bare `Scale` — swapping the axis
 * under a live window, fitting it to an extent, and formatting with the
 * axis's own ruler. The pane owns the scale; these decide what happens to it.
 */
import { autoTickStep, type ValueFormat } from "../axis";
import type { Range } from "../data";
import { ContractError, requireObject } from "../primitives";
import type { ExpandHints, Scale } from "../scale";
import { expandFor } from "./range";
import type { AxisOptions } from "./types";

/**
 * Tries to plant a domain without throwing — `false` on a contract violation.
 *
 * `replantScale` uses this to try moving the current window onto an axis it
 * **hasn't installed yet**. It swallows only `ContractError`, to separate
 * the normal branch (the current window falls outside the new axis's space)
 * from a genuine bug — everything else is rethrown as is.
 */
function trySetDomain(scale: Scale, min: number, max: number): boolean {
  try {
    scale.setDomain(min, max);
    return true;
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return false;
  }
}

/**
 * Carries the current window onto a new axis — the log/linear toggle.
 *
 * **If the window falls outside the new scale's space, don't move it —
 * refit to the data instead.** A linear axis's domain already carries
 * additive padding, so the floor can be negative (10 to 300 becomes
 * `[-19, 329]`), and moving that onto a log scale hits its positive-only
 * contract. **A toggle is a change of axis, not a failure** — keeping the
 * current window is the priority, but when that can't be kept, the right
 * move isn't to throw, it's "show that data on the new axis instead."
 *
 * With no data to measure, `next` keeps its constructor's default domain,
 * which is valid — the first fit overwrites it once data arrives. Throwing
 * here would mean **you can never change the axis on an empty chart**.
 *
 * **Installs nothing.** Whatever throws along the way, the caller still
 * holds its old axis, so the screen stays alive; it plugs `next` in only
 * after this returns.
 */
export function replantScale(
  next: Scale,
  current: Scale,
  extent: Range | null,
  padding: number,
  hints: ExpandHints,
): void {
  requireObject(next, "setYScale(next)");
  if (typeof next.scale !== "function" || typeof next.invert !== "function") {
    throw new ContractError("setYScale(next) must be a Scale (scale, invert)");
  }

  const [min, max] = current.getDomain();
  if (trySetDomain(next, min, max)) return;
  if (extent) fitScale(next, extent, padding, hints);
}

/** Fits a scale to an extent, **asking the scale for the padding** — additive for linear, multiplicative for log. */
export function fitScale(
  scale: Scale,
  extent: Range,
  padding: number,
  hints: ExpandHints,
): void {
  const [min, max] = expandFor(scale, extent, padding, hints);
  scale.setDomain(min, max);
}

/**
 * Formats a value with the axis's own ruler — **down to the tick spacing.**
 *
 * The axis calls `format(value, step)`, but if a badge, tooltip, legend, or
 * priceLine only passed the value, a format function that picks digit
 * count from spacing would drift — the tick reading `0.00001235` while the
 * badge shows `0.00`.
 *
 * **This doesn't hold onto last frame's spacing.** That value goes stale
 * the moment a zoom, resize, or data change happens, and badges get asked
 * outside a frame too (crosshair events). Instead it calls the same
 * arithmetic the axis uses (`autoTickStep`) — there's no stale value to hold.
 */
export function formatOnAxis(
  scale: Scale,
  format: NonNullable<AxisOptions["format"]>,
  minTickSpacing: number | undefined,
  value: number,
): string {
  const [min, max] = scale.getDomain();
  const [from, to] = scale.getRange();
  return format(
    value,
    autoTickStep({
      min,
      max,
      pixels: to - from,
      minTickSpacing,
      orientation: "vertical",
    }),
  );
}

export type { ValueFormat };
