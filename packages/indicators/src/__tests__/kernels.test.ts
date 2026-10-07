import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { ema, highest, lowest, rma, sma, stddev } from "../kernels";

describe("sma", () => {
  it("should stay null until the window fills", () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("should say nothing when the window has a hole", () => {
    // Never average across a hole by skipping it — that would change what
    // "the last 3" means.
    expect(sma([1, null, 3, 4, 5], 3)).toEqual([null, null, null, null, 4]);
  });

  it("should reject a nonsense period", () => {
    expect(() => sma([1], 0)).toThrow();
    expect(() => sma([1], 1.5)).toThrow();
  });

  it("should throw ContractError so consumers can filter by name", () => {
    // A contract violation's name stays the same across package boundaries
    // (primitives/errors).
    expect(() => sma([1], 0)).toThrow(ContractError);
  });
});

describe("ema", () => {
  it("should seed with the simple average of the first period values", () => {
    const out = ema([2, 4, 6, 8], 3);

    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(4); // (2+4+6)/3
    // alpha = 0.5 → 8*0.5 + 4*0.5
    expect(out[3]).toBe(6);
  });

  it("should skip leading nulls — an indicator on an indicator", () => {
    const out = ema([null, null, 2, 4, 6, 8], 3);

    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBe(4);
    expect(out[5]).toBe(6);
  });

  it("should keep its state across an interior hole", () => {
    const out = ema([2, 4, 6, null, 8], 3);

    // The hole itself reads null, but the state survives — EMA is state,
    // not a window.
    expect(out[3]).toBeNull();
    expect(out[4]).toBe(6);
  });

  it("should restart the seed when a hole interrupts it", () => {
    const out = ema([2, null, 4, 6, 8], 3);

    // The seed is three consecutive values — 2 is discarded and 4, 6, 8
    // become the seed.
    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBe(6);
  });
});

describe("rma", () => {
  it("should seed like ema but smooth with alpha = 1/period", () => {
    const out = rma([2, 4, 6, 8], 3);

    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(4); // seed = (2+4+6)/3 — same as ema
    // The recurrence differs — (4*2 + 8) / 3, where ema would have been 6.
    expect(out[3]).toBeCloseTo(16 / 3);
  });

  it("should keep its state across an interior hole", () => {
    const out = rma([2, 4, 6, null, 8], 3);

    expect(out[3]).toBeNull();
    expect(out[4]).toBeCloseTo(16 / 3);
  });

  it("should restart the seed when a hole interrupts it", () => {
    const out = rma([2, null, 4, 6, 8], 3);

    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBe(6); // seed = (4+6+8)/3
  });
});

describe("highest / lowest", () => {
  it("should track the window extremum", () => {
    expect(highest([1, 3, 2, 5, 4], 3)).toEqual([null, null, 3, 5, 5]);
    expect(lowest([5, 3, 4, 1, 2], 3)).toEqual([null, null, 3, 1, 1]);
  });

  it("should drop the extremum once it leaves the window", () => {
    // The departing 9 is still ahead of a smaller candidate (5) that stays: the
    // answer must come from the candidate, not from the slot the 9 vacated.
    expect(highest([9, 5, 2], 2)).toEqual([null, 9, 5]);
    expect(lowest([1, 5, 8], 2)).toEqual([null, 1, 5]);
  });

  it("should follow the same null rules as sma", () => {
    // null whenever the window isn't full or has a hole — never fake a
    // value.
    expect(highest([1, null, 3, 4, 5], 3)).toEqual([
      null,
      null,
      null,
      null,
      5,
    ]);
  });

  it("should reject a nonsense period", () => {
    expect(() => highest([1], 0)).toThrow();
    expect(() => lowest([1], 1.5)).toThrow();
  });
});

describe("stddev", () => {
  it("should measure the window spread", () => {
    const out = stddev([2, 4, 4, 4, 5, 5, 7, 9], 8);

    // A well-known example — population standard deviation 2.
    expect(out[7]).toBeCloseTo(2, 10);
  });

  it("should follow the same null rules as sma", () => {
    expect(stddev([1, null, 3], 2)).toEqual([null, null, null]);
    expect(stddev([1, 1, 1], 3)[2]).toBe(0);
  });
});
