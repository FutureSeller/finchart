/** Pane options with no pane — defaults, the numeric door, and what counts as a state change. */
import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import {
  applyPaneOptions,
  checkPaneNumbers,
  PANE_OPTION_DEFAULTS,
  settleOptions,
} from "../pane-options";

describe("settleOptions", () => {
  it("should fill the defaults from the one shared set", () => {
    const settings = settleOptions({});
    expect(settings.flex).toBe(PANE_OPTION_DEFAULTS.flex);
    expect(settings.minHeight).toBe(PANE_OPTION_DEFAULTS.minHeight);
    expect(settings.valuePadding).toBe(PANE_OPTION_DEFAULTS.valuePadding);
    expect(settings.autoScale).toBe(PANE_OPTION_DEFAULTS.autoScale);
    expect(settings.invert).toBe(PANE_OPTION_DEFAULTS.invert);
    expect(settings.stateKey).toBeNull();
    expect(settings.axis).toEqual({});
  });
});

describe("PANE_OPTION_DEFAULTS", () => {
  it("should carry every option a wrapper has to put back when a prop disappears", () => {
    // A React prop that is removed reverts to the default. The wrapper reads
    // the default from here rather than copying the literal, so the two can't
    // drift — which is why the two booleans live in this set too.
    expect(PANE_OPTION_DEFAULTS).toEqual({
      flex: 1,
      minHeight: 40,
      valuePadding: 0.1,
      autoScale: true,
      invert: false,
    });
  });
});

describe("settleOptions — the booleans", () => {
  it("should keep an explicit false / true rather than the default", () => {
    const settings = settleOptions({ autoScale: false, invert: true });
    expect(settings.autoScale).toBe(false);
    expect(settings.invert).toBe(true);
  });
});

describe("checkPaneNumbers", () => {
  it("should reject a negative flex but keep zero legal", () => {
    expect(() => checkPaneNumbers({ flex: -1 })).toThrow(ContractError);
    expect(() => checkPaneNumbers({ flex: 0 })).not.toThrow();
  });

  it("should reach the nested tick spacing", () => {
    expect(() => checkPaneNumbers({ axis: { minTickSpacing: NaN } })).toThrow(
      ContractError,
    );
  });

  it("should reject an empty stateKey", () => {
    expect(() => checkPaneNumbers({ stateKey: "  " })).toThrow(ContractError);
  });
});

describe("applyPaneOptions", () => {
  it("should change only what is given", () => {
    const current = settleOptions({ flex: 2, axis: { showLabels: false } });
    const { next } = applyPaneOptions(current, { minHeight: 80 });
    expect(next.flex).toBe(2);
    expect(next.minHeight).toBe(80);
    expect(next.axis).toEqual({ showLabels: false });
  });

  it("should merge axis by field", () => {
    const current = settleOptions({ axis: { showLabels: false } });
    const { next } = applyPaneOptions(current, { axis: { minTickSpacing: 30 } });
    expect(next.axis).toEqual({ showLabels: false, minTickSpacing: 30 });
  });

  it("should flag a state change only when a state field actually moves", () => {
    const current = settleOptions({ flex: 2 });
    expect(applyPaneOptions(current, { flex: 2 }).state).toBe(false);
    expect(applyPaneOptions(current, { minHeight: 99 }).state).toBe(false);
    expect(applyPaneOptions(current, { flex: 3 }).state).toBe(true);
    expect(applyPaneOptions(current, { autoScale: false }).state).toBe(true);
    expect(applyPaneOptions(current, { invert: true }).state).toBe(true);
  });

  it("should let a pane claim a stateKey once, through the chart's check", () => {
    const seen: string[] = [];
    const current = settleOptions({});
    const { next, state } = applyPaneOptions(current, { stateKey: "rsi" }, (key) =>
      void seen.push(key),
    );
    expect(next.stateKey).toBe("rsi");
    expect(state).toBe(true);
    expect(seen).toEqual(["rsi"]);
  });

  it("should refuse to change a stateKey already claimed", () => {
    const current = settleOptions({ stateKey: "rsi" });
    expect(() => applyPaneOptions(current, { stateKey: "macd" })).toThrow(
      /already "rsi"/,
    );
    expect(applyPaneOptions(current, { stateKey: "rsi" }).state).toBe(false);
  });

  it("should not touch the current settings object", () => {
    const current = settleOptions({});
    applyPaneOptions(current, { flex: 5, axis: { showLabels: false } });
    expect(current.flex).toBe(1);
    expect(current.axis).toEqual({});
  });
});
