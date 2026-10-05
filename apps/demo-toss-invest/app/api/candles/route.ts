import { NextRequest, NextResponse } from "next/server";
import { getTossAccessToken, TOSS_API_BASE, tossMode } from "../../../lib/toss-auth";
import { publicCandle, publicCursor } from "../../../lib/public-market-data";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

type Interval = "1m" | "1d";

interface TossCandle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

function demoCandles(interval: Interval, count: number, before?: string | null): TossCandle[] {
  const step = interval === "1m" ? 60_000 : 86_400_000;
  const end = before ? Date.parse(before) : Date.UTC(2026, 7, 31, 6);
  let close = 72_400;
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 5) * 620 + Math.sin(index / 13) * 310;
    const open = close;
    close = Math.round(72_000 + wave + index * 13);
    return {
      timestamp: new Date(end - (count - 1 - index) * step).toISOString(),
      openPrice: String(open),
      highPrice: String(Math.max(open, close) + 180 + (index % 4) * 30),
      lowPrice: String(Math.min(open, close) - 160 - (index % 3) * 25),
      closePrice: String(close),
      volume: String(1_200_000 + (index % 11) * 170_000),
      currency: "KRW",
    };
  });
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "005930").toUpperCase();
  const rawInterval = request.nextUrl.searchParams.get("interval") ?? "1d";
  const interval: Interval = rawInterval === "1m" ? "1m" : "1d";
  const before = request.nextUrl.searchParams.get("before");
  if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: "Use a symbol with letters, numbers, or dots." }, { status: 400, headers });
  }
  if (before !== null && !Number.isFinite(Date.parse(before))) {
    return NextResponse.json({ error: "before must be an ISO 8601 date." }, { status: 400, headers });
  }

  try {
    let candles: TossCandle[];
    let source: "toss" | "demo";
    let nextBefore: string | null;
    if (tossMode() === "live") {
      const token = await getTossAccessToken();
      const url = new URL("/api/v1/candles", TOSS_API_BASE);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("interval", interval);
      url.searchParams.set("count", "120");
      url.searchParams.set("adjusted", "true");
      if (before !== null) url.searchParams.set("before", before);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        result?: { candles?: unknown[]; nextBefore?: unknown };
      };
      if (!response.ok || !Array.isArray(payload.result?.candles)) {
        throw new Error("Could not load market data.");
      }
      candles = payload.result.candles.map(publicCandle);
      nextBefore = publicCursor(payload.result.nextBefore);
      source = "toss";
    } else {
      candles = demoCandles(interval, 120, before);
      nextBefore = candles[0]?.timestamp ?? null;
      source = "demo";
    }

    return NextResponse.json({ symbol, interval, source, candles, nextBefore }, { headers });
  } catch {
    // Upstream bodies and exception messages can contain credentials or identifiers.
    return NextResponse.json({ error: "Could not load market data. Check the server configuration." }, { status: 502, headers });
  }
}
