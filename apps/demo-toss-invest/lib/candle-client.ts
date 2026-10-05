import type { CandleResponse, Interval } from "./candles";

export interface CandleRequest {
  symbol: string;
  interval: Interval;
  before?: string;
}

/** Shared transport for the initial load, history pages, and live reconciliation. */
export async function fetchCandles(request: CandleRequest, signal?: AbortSignal): Promise<CandleResponse> {
  const query = new URLSearchParams({ symbol: request.symbol, interval: request.interval });
  if (request.before !== undefined) query.set("before", request.before);
  const response = await fetch(`/api/candles?${query}`, { signal });
  const payload = (await response.json()) as CandleResponse | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error("error" in payload ? payload.error : request.before === undefined ? "Request failed" : "History request failed");
  }
  return payload;
}
