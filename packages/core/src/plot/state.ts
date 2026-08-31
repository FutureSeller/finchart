import type { Range } from "../data";
import { ContractError, requireObject } from "../primitives";
import type { Pane, PaneApi } from "./pane";
/**
 * State slice for one pane → `ChartState.panes`
 *
 * `valueDomain` is **present only when `autoScale` is off** — when it's on,
 * the value domain is a derived value, not state, so there's nothing to
 * carry.
 */
export interface PaneState {
  /** Semantic pane identity. Omitted only for legacy index-based snapshots. */
  stateKey?: string;
  /** Ratio for sharing the remaining vertical space. Changes when the divider is dragged. */
  flex: number;
  /** Whether the value axis tracks the visible range. */
  autoScale: boolean;
  /** A manually set value range. Only present when `autoScale` is off. */
  valueDomain?: Range;
  /** Value-axis inversion. Only carried when it's not the default. */
  invert?: boolean;
}
/**
 * The chart's entire **view state**, as one value.
 *
 * This is the "view state" — not the data, not the series configuration,
 * not the style. It's what the user built through pan, zoom, and dragging,
 * and expects to come back after a refresh: what's in view (x), how the
 * panes are split (flex), and how the value axes are set.
 *
 * **No crosshair.** Cursor position isn't state, it's an echo of input — it
 * lives in pixels and belongs in neither URL storage nor undo. Syncing two
 * charts is already possible via the `crosshair` event (which gives you
 * data x) and `crosshairLine.follow()`.
 *
 * Serialization is a helper's job, not this type's — the version field
 * belongs to the serialization format.
 */
export interface ChartState {
  /**
   * The x range in view, **in data x** (indices never leak out). `null` if
   * it's never been fit to data — the scale's default `[0,1]` isn't state
   * the user made.
   */
  xDomain: Range | null;
  /**
   * Stacking order from the top. A `stateKey` follows its matching pane even
   * when dynamic pane structure changes; snapshots with no keys retain the
   * legacy index pairing.
   */
  panes: PaneState[];
}
/** Reads a pane's public fields into a state slice. Used when Plot builds a snapshot. */
export function paneStateOf(pane: Pane): PaneState {
  const slice: PaneState = { flex: pane.flex, autoScale: pane.autoScale };
  if (pane.stateKey !== null) slice.stateKey = pane.stateKey;
  // Inversion is only carried when it's not the default — keeps serialized output from silently growing.
  if (pane.invert) slice.invert = true;
  if (!pane.autoScale) {
    const [min, max] = pane.yScale.getDomain();
    slice.valueDomain = { min, max };
  }
  return slice;
}

/** Applies one already-matched slice. Plot owns matching; Pane keeps its existing state-door semantics. */
export function applyPaneState(pane: PaneApi, slice: PaneState): void {
  pane.applyOptions({
    flex: slice.flex,
    autoScale: slice.autoScale,
    invert: slice.invert ?? false,
  });
  if (!slice.autoScale && slice.valueDomain) {
    pane.setValueDomain(slice.valueDomain.min, slice.valueDomain.max);
  }
}

/**
 * Pairs saved state with live panes without making ordering a semantic
 * identity. In keyed mode an unkeyed legacy slice may only reach an unkeyed
 * pane at the same position — it never falls through to a differently named
 * pane.
 */
export function matchPaneState(
  panes: readonly PaneApi[],
  slices: readonly PaneState[],
): readonly { pane: PaneApi; slice: PaneState }[] {
  if (!Array.isArray(slices)) {
    throw new ContractError("applyState({ panes }) must be an array");
  }

  const seen = new Set<string>();
  for (const slice of slices) {
    requireObject(slice, "applyState({ panes }) slice");
    if (slice.stateKey === undefined) continue;
    if (typeof slice.stateKey !== "string" || slice.stateKey.trim().length === 0) {
      throw new ContractError("applyState pane stateKey must be a non-empty string");
    }
    if (seen.has(slice.stateKey)) {
      throw new ContractError(`Duplicate pane stateKey: "${slice.stateKey}"`);
    }
    seen.add(slice.stateKey);
  }

  const keyed = slices.some((slice) => slice.stateKey !== undefined) ||
    panes.some((pane) => pane.stateKey !== null);
  if (!keyed) {
    return slices.flatMap((slice, index) => {
      const pane = panes[index];
      return pane ? [{ pane, slice }] : [];
    });
  }

  const byKey = new Map<string, PaneApi>();
  for (const pane of panes) {
    if (pane.stateKey !== null) byKey.set(pane.stateKey, pane);
  }
  return slices.flatMap((slice, index) => {
    if (slice.stateKey !== undefined) {
      const pane = byKey.get(slice.stateKey);
      return pane ? [{ pane, slice }] : [];
    }
    const pane = panes[index];
    return pane?.stateKey === null ? [{ pane, slice }] : [];
  });
}
