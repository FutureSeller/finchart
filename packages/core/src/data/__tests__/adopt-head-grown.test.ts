/**
 * `adoptHeadRetainingTail` — the landing door: replace a head while the
 * manager retains its own already-accepted suffix.
 *
 * Contract: callers cannot smuggle a fresh body through this door. The
 * manager validates the supplied head and seam, then appends the suffix it
 * already owns. `verifyAdoptions` additionally catches illegal mutation of
 * that retained suffix during development.
 */
import { describe, expect, it } from "vitest";
import { ContractError, DataError } from "../../primitives";
import type { LineDataPoint } from "../types";
import { SimpleDataManager } from "../data-manager";
import { M4Decimation } from "../decimation";
import { LineDataAccessor } from "../accessors";

const pt = (x: number, y: number | null = x): LineDataPoint => ({ x, y });
const pts = (from: number, to: number): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x < to; x++) out.push(pt(x));
  return out;
};

function manager(options: { verifyAdoptions?: boolean } = {}) {
  const coordinates = new LineDataAccessor();
  const m = new SimpleDataManager<LineDataPoint>({
    coordinates,
    decimation: new M4Decimation(coordinates),
    ...options,
  });
  m.setData(pts(100, 120));
  return m;
}

describe("adoptHeadRetainingTail", () => {
  it("should replace the head and retain its own corrected tail", () => {
    const m = manager();
    const head = [...pts(90, 100), ...pts(100, 105).map((p) => ({ ...p, y: 1 }))];
    m.adoptHeadRetainingTail(head, 5);

    expect(m.read().map((p) => p.x)).toEqual(pts(90, 120).map((p) => p.x));
    // The corrected zone is new; the uncorrected suffix is selected by the
    // manager, not supplied by the caller.
    expect(m.read()[10].y).toBe(1);
  });

  it("should not alias the caller's array", () => {
    const m = manager();
    const head = pts(90, 100);
    m.adoptHeadRetainingTail(head, 0);
    head[0] = pt(0);
    expect(m.read()[0].x).toBe(90);
  });

  it("should refuse an unsorted head", () => {
    const m = manager();
    const head = [pt(95), pt(92), ...pts(96, 100)];
    expect(() => m.adoptHeadRetainingTail(head, 0)).toThrow(DataError);
  });

  it("should refuse a non-finite head value", () => {
    const m = manager();
    const head = [pt(90), pt(91, Number.NaN), ...pts(92, 100)];
    expect(() => m.adoptHeadRetainingTail(head, 0)).toThrow(DataError);
  });

  it("should refuse a head that overlaps past the seam", () => {
    const m = manager();
    // head's last x (101) sits beyond the retained tail's first (100)
    expect(() => m.adoptHeadRetainingTail(pts(90, 102), 0)).toThrow(DataError);
  });

  it("should allow an equal-x seam on line data — two points at one moment is legal", () => {
    const m = manager();
    const head = [...pts(90, 100), pt(100)];
    m.adoptHeadRetainingTail(head, 0);
    expect(m.read()).toHaveLength(31);
  });

  it("should refuse an empty head or a suffix outside its current data", () => {
    const m = manager();
    const head = pts(90, 100);
    expect(() => m.adoptHeadRetainingTail([], 0)).toThrow(ContractError);
    expect(() => m.adoptHeadRetainingTail(head, -3)).toThrow(ContractError);
    expect(() => m.adoptHeadRetainingTail(head, m.read().length)).toThrow(ContractError);
  });

  it("should refuse to treat a fresh whole body as a head", () => {
    const m = manager();
    expect(() => m.adoptHeadRetainingTail(pts(90, 120), 0)).toThrow(DataError);
  });

  it("should walk the retained suffix under verifyAdoptions", () => {
    const m = manager({ verifyAdoptions: true });
    // The manager owns a copied array but deliberately retains point identity
    // for its adoption proof; this simulates a hostile mutation behind it.
    const retained = (m as unknown as { data: LineDataPoint[] }).data;
    retained[15].y = Number.NaN;
    expect(() => m.adoptHeadRetainingTail(pts(90, 100), 0)).toThrow(DataError);
  });

  it("should reset the viewport cache — the head is visible immediately", () => {
    const m = manager();
    const before = m.getVisibleData({ startX: 80, endX: 130, width: 500, height: 300 });
    expect(before[0].x).toBe(100);
    m.adoptHeadRetainingTail(pts(90, 100), 0);
    const after = m.getVisibleData({ startX: 80, endX: 130, width: 500, height: 300 });
    expect(after[0].x).toBe(90);
  });
});
