import { describe, expect, it } from "vitest";
import { fakeCanvasContext } from "../../__tests__/dom-fakes";
import type { OHLC } from "../../data";
import { CanvasRenderer } from "../../render";
import { continuousX, LinearScale } from "../../scale";
import { candleSeries } from "../candle-series";
import { slotWidth } from "../slot";

const WIDTH = 800;

const candles = (from: number, to: number): OHLC[] =>
  Array.from({ length: to - from }, (_, i) => ({
    x: from + i,
    open: 50,
    close: 52,
    high: 54,
    low: 48,
  }));

/** Clips to the given domain range, draws, and returns the body widths. */
function bodyWidths(
  data: OHLC[],
  domain: [number, number],
  fullData?: OHLC[],
): number[] {
  const renderer = new CanvasRenderer({
    width: WIDTH,
    height: 600,
    context: fakeCanvasContext(),
  });
  const xScale = new LinearScale(domain[0], domain[1], 0, WIDTH);
  const visible = data.filter(
    (candle) => Number(candle.x) >= domain[0] && Number(candle.x) <= domain[1],
  );

  candleSeries().draw(renderer, {
    data: visible,
    x: continuousX(xScale),
    yScale: new LinearScale(0, 100, 600, 0),
    area: { left: 0, right: WIDTH, top: 0, bottom: 600 },
    readStyle: () => "",
    fullData,
  });

  return renderer
    .getCommands()
    .flatMap((command) =>
      command.type === "drawShape" && command.shape.shape === "rect"
        ? [command.shape.width]
        : [],
    );
}

describe("candle width", () => {
  const data = candles(0, 100);

  it("should fill its slot when the data spans the view", () => {
    const [width] = bodyWidths(data, [0, 99]);

    // 100 candles split roughly 800px, so each slot is about 8px, and the
    // body is 60% of that.
    expect(width).toBeCloseTo(4.8, 0);
  });

  it("should keep that width when panned past the end of the data", () => {
    const full = bodyWidths(data, [0, 99])[0];

    // Panned right so the data only occupies the left fifth of the view.
    const panned = bodyWidths(data, [80, 179]);

    expect(panned.length).toBeGreaterThan(0);
    for (const width of panned) expect(width).toBeCloseTo(full, 1);
  });

  it("should keep that width when panned before the start of the data", () => {
    const full = bodyWidths(data, [0, 99])[0];

    const panned = bodyWidths(data, [-80, 19]);

    expect(panned.length).toBeGreaterThan(0);
    for (const width of panned) expect(width).toBeCloseTo(full, 1);
  });

  it("should never let one candle swallow the plot", () => {
    // Only one candle straddles the edge of the view.
    for (const width of bodyWidths(data, [99, 198])) {
      expect(width).toBeLessThan(WIDTH / 4);
    }
  });

  it("should widen as the view zooms in", () => {
    const wide = bodyWidths(data, [0, 99])[0];
    const zoomed = bodyWidths(data, [40, 49])[0];

    expect(zoomed).toBeGreaterThan(wide);
  });

  it("should reflect the current zoom, not a fixed fallback, when panning leaves only one candle visible", () => {
    // Zoomed way in — 80,000px per domain unit — and clipped so exactly
    // one candidate (x=50) remains in the viewport, with no neighbor
    // inside it.
    const zoomed = bodyWidths(data, [50, 50.01], data);

    expect(zoomed.length).toBe(1);
    // At the FALLBACK_SLOT(8px) baseline the body would be only a few px.
    // Remeasuring with fullData at the current scale (80,000px/unit)
    // should give a much wider result.
    expect(zoomed[0]).toBeGreaterThan(1000);
  });

  it("should use its one real neighbor when panned exactly to the last candle in history", () => {
    // Panned to the actual last candle in the data (x=99) — there's no
    // neighbor to the right, so it must measure from the single left
    // neighbor alone.
    const zoomed = bodyWidths(data, [99, 99.01], data);

    expect(zoomed.length).toBe(1);
    expect(zoomed[0]).toBeGreaterThan(1000);
  });

  it("should fall back to a fixed width only for a genuine single-point dataset", () => {
    const single: OHLC[] = [{ x: 50, open: 50, close: 52, high: 54, low: 48 }];

    const [width] = bodyWidths(single, [45, 55], single);

    // No neighbor in the viewport or in the full data, so the width falls
    // back to FALLBACK_SLOT.
    expect(width).toBeCloseTo(4.8, 0);
  });

  it("should survive a gap in the data", () => {
    // Even with a no-trading gap mixed in, it follows the representative
    // spacing.
    const withGap = [...candles(0, 20), ...candles(60, 80)];

    for (const width of bodyWidths(withGap, [0, 79])) {
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThan(WIDTH / 4);
    }
  });
});

it("measures dense uniformly spaced bars and duplicate-heavy spacing", () => {
  const mapping = continuousX(new LinearScale());
  expect(slotWidth(Array.from({ length: 100_000 }, (_, x) => ({ x })), mapping)).toBe(1);
  const gaps = Array.from({ length: 10_000 }, (_, i) => i % 7 === 0 ? 4 : 1);
  let x = 0;
  const points = [{ x }, ...gaps.map(gap => ({ x: x += gap }))];
  expect(slotWidth(points, mapping)).toBe([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]);
});

it("agrees with a sorted median for ascending, descending, and mixed gaps", () => {
  const mapping = continuousX(new LinearScale());
  for (const gaps of [Array.from({ length: 1000 }, (_, i) => i + 1), Array.from({ length: 1000 }, (_, i) => 1000 - i), Array.from({ length: 1000 }, (_, i) => 1 + (i * 7919) % 101)]) {
    let x = 0;
    const points = [{ x }, ...gaps.map(gap => ({ x: x += gap }))];
    expect(slotWidth(points, mapping)).toBe([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]);
  }
});
