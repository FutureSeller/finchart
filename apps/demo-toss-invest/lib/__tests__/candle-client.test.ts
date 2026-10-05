import { afterEach, expect, it, vi } from "vitest";
import { fetchCandles } from "../candle-client";

afterEach(() => vi.unstubAllGlobals());

it("preserves the upstream history cursor and the caller's cancellation signal", async () => {
  const payload = { symbol: "005930", interval: "1m", source: "demo", candles: [], nextBefore: null };
  const fetch = vi.fn().mockResolvedValue(Response.json(payload));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const before = "2026-08-31T09:00:00+09:00";
  expect(await fetchCandles({ symbol: "005930", interval: "1m", before }, controller.signal)).toEqual(payload);
  const [path, options] = fetch.mock.calls[0];
  const url = new URL(path, "http://localhost");
  expect(url.pathname).toBe("/api/candles");
  expect(Object.fromEntries(url.searchParams)).toEqual({ symbol: "005930", interval: "1m", before });
  expect(options.signal).toBe(controller.signal);
});

it("rejects failed loads and failed history pages with their existing UI messages", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "Market data unavailable." }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({}, { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchCandles({ symbol: "005930", interval: "1d" })).rejects.toThrow("Market data unavailable.");
  await expect(fetchCandles({ symbol: "005930", interval: "1d", before: "2026-08-31T00:00:00Z" })).rejects.toThrow("History request failed");
});
