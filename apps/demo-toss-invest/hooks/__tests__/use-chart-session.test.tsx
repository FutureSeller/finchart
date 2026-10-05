// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Plot } from "@finchart/core";
import type { DrawingToolsApi } from "@finchart/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Interval } from "../../lib/candles";
import { useChartSession } from "../use-chart-session";

let root: Root;
let element: HTMLDivElement;
let session: ReturnType<typeof useChartSession>;
let frame: FrameRequestCallback;
const cancelFrame = vi.fn();

function Probe({ symbol = "005930", interval = "1d" }: { symbol?: string; interval?: Interval }) {
  session = useChartSession(symbol, interval);
  return null;
}

function toolbox(saved: string) {
  return {
    serialize: vi.fn(() => saved), load: vi.fn(), begin: vi.fn(),
    mode: () => null, modeChanges: { subscribe: () => () => {} },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 42; }));
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  cancelFrame.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

describe("chart session", () => {
  it("restores a lane's drawings through remounts and keeps the other lane separate", async () => {
    await act(async () => root.render(<Probe />));
    const price = toolbox("price-drawings");
    const rsi = toolbox("rsi-drawings");
    await act(async () => {
      session.onPriceTools(price as unknown as DrawingToolsApi);
      session.onRsiTools(rsi as unknown as DrawingToolsApi);
    });
    await act(async () => { session.onPriceTools(null); session.onRsiTools(null); });
    const nextPrice = toolbox(""); const nextRsi = toolbox("");
    await act(async () => {
      session.onPriceTools(nextPrice as unknown as DrawingToolsApi);
      session.onRsiTools(nextRsi as unknown as DrawingToolsApi);
    });
    expect(nextPrice.load).toHaveBeenCalledWith("price-drawings");
    expect(nextRsi.load).toHaveBeenCalledWith("rsi-drawings");
  });

  it("does not restore the old symbol's drawings after a late tool teardown", async () => {
    await act(async () => root.render(<Probe />));
    const oldRecipient = session.onPriceTools;
    await act(async () => oldRecipient(toolbox("old-symbol") as unknown as DrawingToolsApi));
    session.resetForSymbol("AAPL");
    await act(async () => root.render(<Probe symbol="AAPL" />));
    await act(async () => oldRecipient(null));
    const fresh = toolbox("");
    await act(async () => session.onPriceTools(fresh as unknown as DrawingToolsApi));
    expect(fresh.load).not.toHaveBeenCalled();
  });

  it("restores the time range once after remount and cancels deferred work on unmount", async () => {
    await act(async () => root.render(<Probe />));
    const range = { min: 10, max: 40 };
    const plot = { getVisibleRange: () => range, setVisibleRange: vi.fn() };
    session.plotRef.current = plot as unknown as Plot;
    session.saveTimeWindow();
    session.restoreTimeWindow(); session.restoreTimeWindow();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    frame(0);
    expect(plot.setVisibleRange).toHaveBeenCalledWith(10, 40);
    session.restoreTimeWindow();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    session.saveTimeWindow(); session.restoreTimeWindow();
    await act(async () => root.unmount());
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it("hands keyboard focus back to the chart when starting a drawing", async () => {
    await act(async () => root.render(<Probe />));
    element.tabIndex = 0;
    session.chartElement.current = element;
    const tools = toolbox("");
    session.draw(tools as unknown as DrawingToolsApi, "trend");
    expect(tools.begin).toHaveBeenCalledWith("trend");
    expect(document.activeElement).toBe(element);
  });

  it("does not apply a deferred range belonging to the previous interval", async () => {
    await act(async () => root.render(<Probe />));
    const plot = { getVisibleRange: () => ({ min: 10, max: 40 }), setVisibleRange: vi.fn() };
    session.plotRef.current = plot as unknown as Plot;
    session.saveTimeWindow(); session.restoreTimeWindow();
    await act(async () => root.render(<Probe interval="1m" />));
    expect(cancelFrame).toHaveBeenCalledWith(42);
    frame(0);
    expect(plot.setVisibleRange).not.toHaveBeenCalled();
  });
});
