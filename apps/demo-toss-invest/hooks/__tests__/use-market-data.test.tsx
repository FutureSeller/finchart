// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandleResponse, Interval } from "../../lib/candles";
import { useMarketData, type MarketDataState } from "../use-market-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function candles(symbol: string, source: "demo" | "toss" = "demo"): CandleResponse {
  return {
    symbol, interval: "1d", source, nextBefore: null,
    candles: [{ timestamp: "2026-08-31T00:00:00Z", openPrice: "100", highPrice: "110", lowPrice: "95", closePrice: "105", volume: "3", currency: "KRW" }],
  };
}

let root: Root;
let element: HTMLDivElement;
let state: MarketDataState;
const fetchMock = vi.fn<typeof fetch>();
const liveStreams: (EventTarget & { closed: boolean })[] = [];

function Probe({ symbol, interval = "1d", onCommit }: {
  symbol: string;
  interval?: Interval;
  onCommit?: (committed: MarketDataState) => void;
}) {
  const current = useMarketData(symbol, interval);
  state = current;
  useLayoutEffect(() => onCommit?.(current));
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  // Exercise the real hook while keeping every request local and every trade fabricated.
  vi.stubGlobal("EventSource", class extends EventTarget {
    closed = false;
    constructor() { super(); liveStreams.push(this); }
    close() { this.closed = true; }
  });
  fetchMock.mockReset();
  liveStreams.length = 0;
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("market data ownership", () => {
  it("aborts the previous load and ignores its late success", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json(candles("AAPL")));
    await act(async () => root.render(<Probe symbol="005930" />));
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    await act(async () => root.render(<Probe symbol="AAPL" />));
    expect(oldSignal?.aborted).toBe(true);
    expect(state.result?.symbol).toBe("AAPL");
    await act(async () => old.resolve(Response.json(candles("005930"))));
    expect(state.result?.symbol).toBe("AAPL");
    expect(state.bars).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it("clears the previous quote and bars when the new load fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930")))
      .mockResolvedValueOnce(Response.json({ error: "Market data unavailable." }, { status: 502 }));
    await act(async () => root.render(<Probe symbol="005930" />));
    expect(state.bars).toHaveLength(1);
    await act(async () => root.render(<Probe symbol="AAPL" />));
    expect(state.result).toBeNull();
    expect(state.bars).toEqual([]);
    expect(state.error).toBe("Market data unavailable.");
    expect(state.realtime).toBe("off");
  });

  it("drops a live REST refresh after a different symbol has loaded", async () => {
    vi.useFakeTimers();
    const refresh = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930", "toss")))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(Response.json(candles("AAPL")));
    await act(async () => root.render(<Probe symbol="005930" />));
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<Probe symbol="AAPL" />));
    const before = state.bars;
    await act(async () => refresh.resolve(Response.json({ ...candles("005930", "toss"), candles: [] })));
    expect(state.result?.symbol).toBe("AAPL");
    expect(state.bars).toBe(before);
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it("drops a live REST refresh that lands after a new market commits but before the old poll is cancelled", async () => {
    // Only the poll is faked: React's own scheduling must run on real tasks below.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const refresh = deferred<Response>();
    const load = deferred<Response>();
    const stale = candles("005930", "toss");
    stale.candles[0].highPrice = "500";
    let refreshSignal: AbortSignal | null | undefined;
    // Whether the old poll was already cancelled when its snapshot was read —
    // the race exists only if it was not.
    let cancelledWhenRead: boolean | undefined;
    class WatchedResponse extends Response {
      override json() {
        cancelledWhenRead = refreshSignal?.aborted;
        return super.json();
      }
    }
    const staleResponse = new WatchedResponse(JSON.stringify(stale));
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930", "toss")))
      .mockReturnValueOnce(refresh.promise)
      .mockReturnValueOnce(load.promise);
    // The old market's snapshot arrives the moment the new one is on screen.
    const onCommit = (committed: MarketDataState) => {
      if (committed.result?.symbol === "AAPL") refresh.resolve(staleResponse);
    };
    await act(async () => root.render(<Probe symbol="005930" />));
    await act(async () => { vi.advanceTimersByTime(15_000); });
    refreshSignal = fetchMock.mock.calls[1][1]?.signal;
    await act(async () => root.render(<Probe symbol="AAPL" onCommit={onCommit} />));

    // Outside act React commits in one task and cancels the old poll in a
    // later one, as in a browser; a response landing between the two is
    // told apart only by which load it was requested under.
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    load.resolve(Response.json(candles("AAPL")));
    // Settled once the new market is shown, the stale snapshot has been read
    // and the old poll is cancelled; the cap only bounds a hang.
    const settled = () =>
      state.result?.symbol === "AAPL" && staleResponse.bodyUsed && refreshSignal?.aborted === true;
    for (let turn = 0; turn < 200 && !settled(); turn++) await new Promise((done) => setTimeout(done, 0));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    expect(settled()).toBe(true);
    expect(cancelledWhenRead).toBe(false);
    expect(state.result?.symbol).toBe("AAPL");
    expect(state.bars.map((bar) => bar.high)).toEqual([110]);
  });

  it("does not poll synthetic data and aborts an unfinished load on unmount", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930")));
    await act(async () => root.render(<Probe symbol="005930" />));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Probe symbol="AAPL" />));
    const signal = fetchMock.mock.calls[1][1]?.signal;
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
  });

  it("aggregates every trade in a burst and closes the live stream on a demo switch", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930", "toss")))
      .mockResolvedValueOnce(Response.json(candles("AAPL")));
    await act(async () => root.render(<Probe symbol="005930" />));
    const stream = liveStreams.at(-1)!;
    await act(async () => {
      for (const price of ["106", "108", "107"]) {
        stream.dispatchEvent(new MessageEvent("trade", { data: JSON.stringify({ price, volume: "2", timestamp: "2026-08-31T01:00:00Z", currency: "KRW" }) }));
      }
    });
    expect(state.bars.at(-1)?.volume).toBe(9);
    expect(state.bars.at(-1)?.close).toBe(107);
    expect(state.currentTrade?.tick.price).toBe("107");
    await act(async () => root.render(<Probe symbol="AAPL" />));
    expect(stream.closed).toBe(true);
    expect(state.currentTrade).toBeNull();
  });

  it("restarts reconciliation when a cancelled interval switch returns to the same market", async () => {
    vi.useFakeTimers();
    const interrupted = deferred<Response>();
    const refreshed = candles("005930", "toss");
    refreshed.candles[0].highPrice = "500";
    fetchMock.mockResolvedValueOnce(Response.json(candles("005930", "toss")))
      .mockReturnValueOnce(interrupted.promise)
      .mockResolvedValueOnce(Response.json(candles("005930", "toss")))
      .mockResolvedValueOnce(Response.json(refreshed));
    await act(async () => root.render(<Probe symbol="005930" />));
    await act(async () => root.render(<Probe symbol="005930" interval="1m" />));
    await act(async () => root.render(<Probe symbol="005930" interval="1d" />));
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(state.bars[0].high).toBe(500);
  });
});
