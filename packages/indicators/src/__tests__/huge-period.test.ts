/**
 * A period far longer than the data — a user typing 200000000 into a period
 * field — must cost what the data costs, not what the period says. The fold
 * buffers grow with the values that actually arrive.
 */
import type { OHLC } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { movingAverage } from "../factories";
import { highestFold, lagFold, linregFold, lowestFold, stddevFold, sumFold } from "../kernels";

const HUGE = 200_000_000;

const bars: OHLC[] = Array.from({ length: 50 }, (_, i) => ({ x: i, open: 10, high: 11, low: 9, close: 10 + (i % 3), volume: 100 }));

describe("a period longer than the data", () => {
  it.each([
    ["sumFold", () => sumFold(HUGE)],
    ["highestFold", () => highestFold(HUGE)],
    ["lowestFold", () => lowestFold(HUGE)],
    ["stddevFold", () => stddevFold(HUGE)],
    ["linregFold", () => linregFold(HUGE)],
    ["lagFold", () => lagFold(HUGE)],
  ])("%s steps without allocating the period", (_name, make) => {
    const started = performance.now();
    const fold = make();
    for (let i = 0; i < 50; i++) expect(fold.step(i)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("a moving average over it reads as all gaps — the window never fills", () => {
    const source = { read: () => bars };
    const ma = movingAverage(source, { period: HUGE }).out.ma.read();
    expect(ma).toHaveLength(50);
    expect(ma.every((point) => point.y === null)).toBe(true);
  });
});
