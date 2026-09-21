import { expect, it } from "vitest";
import { slotWidth } from "../slot";
import { continuousX, LinearScale } from "../../scale";

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
