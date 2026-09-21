import { lowerBoundBy } from "../data";
import type { BaseDataPoint } from "../data";
import type { XMapping } from "../scale";

/**
 * The last-resort fallback width (px), used when there's no neighbor in
 * the viewport or in the full dataset either (a genuinely single-point
 * dataset). At that point there's no way at all to know the current zoom
 * level — there's no interval left in the data to measure.
 */
export const FALLBACK_SLOT = 8;

/**
 * A slot is the pixel gap between neighboring bars. The three series
 * that need a width (candle, histogram, bar) all use this same
 * arithmetic — measuring it separately in each would eventually let them
 * drift apart.
 *
 * Dividing the plot width by the visible count breaks down once panning
 * goes past the end of the data — the handful of points left behind
 * would split the whole screen between them and turn into giant blocks.
 * A gap stays the same even as the count shrinks, so the width doesn't
 * wobble.
 *
 * When `data` (already sliced to the viewport) has no neighbor at all
 * (panning past the end of the data leaves a single point), the actual
 * left and right neighbors of that point are found in `fullData` (the
 * full registered dataset) by binary search, and the width is
 * **re-measured at the current scale** — this is O(log n), not a scan of
 * the entire dataset, so staying at the edge of the screen for frame
 * after frame on a dataset of hundreds of thousands of points costs
 * almost nothing. (In the genuinely rare case where the viewport has two
 * or more points but every pixel gap between them is 0, no single
 * representative point can be pinned down, so it falls back to the
 * median over the whole of `fullData`.) Only when `fullData` also has no
 * neighbor (a truly single-point dataset) does it finally fall to
 * `FALLBACK_SLOT`.
 */
export function slotWidth<T extends BaseDataPoint>(
  data: readonly T[],
  mapping: XMapping,
  places?: number[] | null,
  fullData?: readonly T[],
): number {
  // No points, no width — if data isn't an array, give 0 instead of
  // throwing on .length (nothing gets drawn).
  if (!Array.isArray(data)) return 0;

  const gaps = pixelGaps(data, mapping, places);
  if (gaps.length > 0) return median(gaps);

  if (Array.isArray(fullData) && fullData.length > 1) {
    if (data.length === 1) {
      const local = neighborGap(data[0], fullData, mapping);
      if (local !== null) return local;
    } else {
      const wide = pixelGaps(fullData, mapping);
      if (wide.length > 0) return median(wide);
    }
  }

  return FALLBACK_SLOT;
}

/**
 * Finds where `point` sits in `fullData` by binary search alone and
 * measures just its immediate left and right — it never scans the whole
 * dataset chasing a representative value. Both sides present: the
 * average. Only one side present (the very end of the data): that one
 * alone.
 */
function neighborGap<T extends BaseDataPoint>(
  point: T,
  fullData: readonly T[],
  mapping: XMapping,
): number | null {
  const index = lowerBoundBy(fullData, Number(point.x), (p) => Number(p.x));
  const at = (i: number) => mapping.toPixel(fullData[i].x);
  const here = at(Math.min(index, fullData.length - 1));

  const before = index > 0 ? Math.abs(here - at(index - 1)) : null;
  const after = index < fullData.length - 1 ? Math.abs(at(index + 1) - here) : null;

  if (before !== null && after !== null) return (before + after) / 2;
  return before ?? after;
}

function pixelGaps<T extends BaseDataPoint>(
  data: readonly T[],
  mapping: XMapping,
  places?: number[] | null,
): number[] {
  const gaps: number[] = [];

  // One arithmetic operation per point when a place accompanies it,
  // otherwise asking the mapping — the same choice rule as `screenXAt`.
  const toPx = mapping.domainToPixel;
  const pixelAt =
    places != null && toPx !== undefined
      ? (i: number) => toPx(places[i])
      : (i: number) => mapping.toPixel(data[i].x);

  // Ask each point only once and carry the previous value forward —
  // querying each neighbor twice would make queries jump back and forth
  // and double the count, going against the grain of a scan pass
  // (`scanToPixel`).
  let previous = data.length > 0 ? pixelAt(0) : 0;
  for (let i = 1; i < data.length; i++) {
    const current = pixelAt(i);
    const gap = Math.abs(current - previous);
    previous = current;
    if (gap > 0) gaps.push(gap);
  }

  return gaps;
}

/**
 * Picks the median without sorting (quickselect).
 *
 * This runs every frame, so it trades an O(n log n) sort for O(n)
 * average, with a bounded O(n log n) fallback. Equal gaps take one pass.
 * `values` gets shuffled inside this function, so the caller's
 * array must not be reused afterward.
 */
function median(values: number[]): number {
  const target = Math.floor(values.length / 2);
  let low = 0;
  let high = values.length - 1;
  let budget = values.length * 4;

  while (low < high) {
    // Bound even adversarial pivot sequences; ordinary equal spacing is
    // consumed by the equal partition in a single linear pass.
    budget -= high - low + 1;
    if (budget < 0) {
      return values.slice(low, high + 1).sort((a, b) => a - b)[target - low];
    }
    const middle = (low + high) >>> 1;
    const a = values[low], b = values[middle], c = values[high];
    const pivot = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    let less = low;
    let at = low;
    let greater = high;
    while (at <= greater) {
      if (values[at] < pivot) {
        [values[at], values[less]] = [values[less], values[at]];
        less++;
        at++;
      } else if (values[at] > pivot) {
        [values[at], values[greater]] = [values[greater], values[at]];
        greater--;
      } else {
        at++;
      }
    }
    if (target < less) high = less - 1;
    else if (target > greater) low = greater + 1;
    else return pivot;
  }
  return values[target];
}
