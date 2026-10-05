import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";

vi.mock("server-only", () => ({}));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    static CLOSING = 2;
    static latest: FakeSocket;
    readyState = 1;
    constructor() { super(); FakeSocket.latest = this; }
    send() {}
    close() { this.readyState = 3; }
  }
  return { default: FakeSocket };
});

const candle = {
  timestamp: "2026-08-31T00:00:00Z", openPrice: "100", highPrice: "105",
  lowPrice: "99", closePrice: "102", volume: "120", currency: "KRW",
};
const privateFields = { accountNumber: "PRIVATE_ACCOUNT", ownerName: "PRIVATE_OWNER", access_token: "PRIVATE_TOKEN" };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TOSSINVEST_MODE", "demo");
  vi.stubEnv("TOSSINVEST_CLIENT_ID", "test-client");
  vi.stubEnv("TOSSINVEST_CLIENT_SECRET", "test-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("public market-data boundary", () => {
  it("drops unknown candle and trade fields rather than forwarding upstream objects", async () => {
    const { publicCandle, publicTrade } = await import("../public-market-data");
    expect(publicCandle({ ...candle, ...privateFields })).toEqual({ ...candle, timestamp: "2026-08-31T00:00:00.000Z" });
    expect(publicTrade({ price: "102", volume: "3", timestamp: candle.timestamp, currency: "KRW", ...privateFields }))
      .toEqual({ price: "102", volume: "3", timestamp: "2026-08-31T00:00:00.000Z", currency: "KRW" });
    expect(() => publicCandle({ ...candle, closePrice: "PRIVATE_TOKEN" })).toThrow();
  });

  it("defaults to demo data even when ambient credentials exist", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { tossMode } = await import("../toss-auth");
    expect(tossMode()).toBe("demo");
    vi.stubEnv("TOSSINVEST_MODE", "");
    expect(tossMode()).toBe("demo");
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../../app/api/candles/route");
    const response = await GET(new NextRequest("http://localhost/api/candles?symbol=005930"));
    expect(response.status).toBe(200);
    expect((await response.json()).source).toBe("demo");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose upstream token errors or account details", async () => {
    vi.stubEnv("TOSSINVEST_MODE", "live");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_description: "PRIVATE_TOKEN PRIVATE_ACCOUNT" }), { status: 401 })));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../../app/api/candles/route");
    const response = await GET(new NextRequest("http://localhost/api/candles?symbol=005930"));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("PRIVATE_");
  });

  it("projects candle responses to the allowlist", async () => {
    vi.stubEnv("TOSSINVEST_MODE", "live");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "PRIVATE_TOKEN", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { candles: [{ ...candle, ...privateFields }], nextBefore: candle.timestamp, ...privateFields }, ...privateFields }))));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../../app/api/candles/route");
    const response = await GET(new NextRequest("http://localhost/api/candles?symbol=005930"));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("PRIVATE_");
  });

  it("replaces candle service errors and malformed private cursors with fixed errors", async () => {
    vi.stubEnv("TOSSINVEST_MODE", "live");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "PRIVATE_TOKEN", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(privateFields), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { candles: [candle], nextBefore: "PRIVATE_ACCOUNT" } }))));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../../app/api/candles/route");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await GET(new NextRequest("http://localhost/api/candles?symbol=005930"));
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("PRIVATE_");
    }
  });

  it("hides realtime authentication errors before opening a socket", async () => {
    vi.stubEnv("TOSSINVEST_MODE", "live");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("PRIVATE_TOKEN PRIVATE_ACCOUNT")));
    const { GET } = await import("../../app/api/realtime/route");
    const response = await GET(new Request("http://localhost/api/realtime?symbol=005930"));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("PRIVATE_");
  });

  it("sanitizes WebSocket trades and errors before emitting SSE", async () => {
    vi.stubEnv("TOSSINVEST_MODE", "live");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "PRIVATE_TOKEN", expires_in: 3600 }))));
    const WebSocket = (await import("ws")).default as unknown as { latest: EventEmitter };
    const { GET } = await import("../../app/api/realtime/route");
    const request = new Request("http://localhost/api/realtime?symbol=005930");
    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      await reader.read();
      WebSocket.latest.emit("message", Buffer.from(JSON.stringify({ type: "message", data: { price: "102", volume: "3", timestamp: candle.timestamp, currency: "KRW", ...privateFields } })));
      const trade = decoder.decode((await reader.read()).value);
      expect(trade).toContain('"price":"102"');
      expect(trade).not.toContain("PRIVATE_");
      for (const frame of [
        { type: "subscriptions", accepted: [privateFields] },
        { type: "subscriptions", rejected: [privateFields] },
        { type: "error", ...privateFields },
        { type: "message", data: { ...candle, price: "PRIVATE_TOKEN" } },
      ]) {
        WebSocket.latest.emit("message", Buffer.from(JSON.stringify(frame)));
        expect(decoder.decode((await reader.read()).value)).not.toContain("PRIVATE_");
      }
      WebSocket.latest.emit("error", new Error("PRIVATE_TOKEN PRIVATE_ACCOUNT"));
      expect(decoder.decode((await reader.read()).value)).not.toContain("PRIVATE_");
    } finally {
      await reader.cancel();
    }
  });
});
