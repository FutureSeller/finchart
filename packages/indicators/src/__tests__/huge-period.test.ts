/**
 * A period far longer than the data — a user typing a huge number into a
 * period field — must cost what the data costs, not what the period says. The
 * fold buffers grow with the values that actually arrive.
 *
 * The folds take 2^32, the smallest length no plain array can have: a fold that
 * allocates an array of the period at once throws here on any machine.
 *
 * A fold that walks the period runs 2^32 iterations. That takes seconds even as
 * an empty loop and tens of seconds when it reads past the array, against
 * microseconds for the 50 values. The 1000 ms bound sits far above the real
 * cost and about three times below the cheapest walk measured on the machine
 * this was written on (an empty loop; an Apple-silicon laptop on Node 24).
 *
 * The clock starts before construction and the bound is checked after each
 * step, so a walk in construction or in a step fails after that one walk, and a
 * walk in the snapshot or restore after that round trip. A larger period would
 * only make a walking fold take longer to fail, since a synchronous loop cannot
 * be interrupted.
 *
 * The moving average takes what a user might type instead. It runs its 50 steps
 * inside one read, where a walk per step costs fifty walks: walks that read
 * past the array measured between ten seconds and a minute in all at this
 * period, and would take about half an hour at 2^32. A single walk at this
 * period can stay under the bound, so only a walk per step reliably fails here.
 */
import type { OHLC } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { movingAverage } from "../factories";
import { highestFold, lagFold, linregFold, lowestFold, smaFold, stddevFold, sumFold } from "../kernels";

const NO_ARRAY_LENGTH = 2 ** 32;
const USER_PERIOD = 200_000_000;

const bars: OHLC[] = Array.from({ length: 50 }, (_, i) => ({ x: i, open: 10, high: 11, low: 9, close: 10 + (i % 3), volume: 100 }));

/** A fold as the kernels shape it, with its own state type. */
interface Fold<S extends object> {
  step(value: number | null): number | null;
  snapshot(): S;
  restore(state: S): void;
}

function stepsWithinTheData<S extends object>(make: () => Fold<S>): void {
  const started = performance.now();
  const fold = make();
  const steps: (number | null)[] = [];
  for (let i = 0; i < 50; i++) {
    steps.push(fold.step(i));
    expect(performance.now() - started).toBeLessThan(1000);
  }
  fold.restore(fold.snapshot());
  const state = fold.snapshot();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(steps).toEqual(Array.from({ length: 50 }, () => null));
  // No buffer outgrows the values that arrived, through the steps or the
  // restore — a write past them, such as a ring index off by one, shows up as
  // length. This reads the state's shape on purpose; a shape with no arrays
  // fails here rather than passing unchecked.
  const parts: unknown[] = Object.values(state);
  const buffers = parts.filter((part) => Array.isArray(part));
  expect(buffers.length).toBeGreaterThan(0);
  for (const buffer of buffers) expect(buffer.length).toBeLessThanOrEqual(50);
}

describe("a period longer than the data", () => {
  it.each([
    ["smaFold", () => stepsWithinTheData(() => smaFold(NO_ARRAY_LENGTH))],
    ["sumFold", () => stepsWithinTheData(() => sumFold(NO_ARRAY_LENGTH))],
    ["highestFold", () => stepsWithinTheData(() => highestFold(NO_ARRAY_LENGTH))],
    ["lowestFold", () => stepsWithinTheData(() => lowestFold(NO_ARRAY_LENGTH))],
    ["stddevFold", () => stepsWithinTheData(() => stddevFold(NO_ARRAY_LENGTH))],
    ["linregFold", () => stepsWithinTheData(() => linregFold(NO_ARRAY_LENGTH))],
    ["lagFold", () => stepsWithinTheData(() => lagFold(NO_ARRAY_LENGTH))],
  ])("%s steps, snapshots and restores without allocating the period", (_name, check) => check());

  it("a moving average over it reads as all gaps — the window never fills", () => {
    const source = { read: () => bars };
    const started = performance.now();
    const ma = movingAverage(source, { period: USER_PERIOD }).out.ma.read();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(ma).toHaveLength(50);
    expect(ma.every((point) => point.y === null)).toBe(true);
  });
});
