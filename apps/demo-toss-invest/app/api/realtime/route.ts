import WebSocket from "ws";
import { getTossAccessToken, tossMode } from "../../../lib/toss-auth";
import { publicTrade } from "../../../lib/public-market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WS_URL = "wss://openapi-ws.tossinvest.com/ws/v1";
const encoder = new TextEncoder();

function validSymbol(symbol: string) {
  return /^[A-Z0-9.]{1,12}$/.test(symbol);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const headers = { "Cache-Control": "no-store" };
  if (!validSymbol(symbol)) return Response.json({ error: "A valid symbol is required." }, { status: 400, headers });

  let token: string;
  try {
    if (tossMode() !== "live") return Response.json({ error: "Realtime is disabled in demo mode." }, { status: 409, headers });
    token = await getTossAccessToken();
  } catch {
    return Response.json({ error: "Could not connect to market data. Check the server configuration." }, { status: 502, headers });
  }
  let socket: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let finished = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (finished) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        if (pingTimer) clearInterval(pingTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
        try { controller.close(); } catch { /* request already closed */ }
      };

      send("status", { state: "connecting" });
      heartbeatTimer = setInterval(() => send("heartbeat", { at: Date.now() }), 15_000);
      socket = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${token}` } });
      socket.on("open", () => {
        const market = /^\d{6}$/.test(symbol) ? "kr" : "us";
        socket?.send(JSON.stringify([{ type: `trade:${market}`, codes: [symbol] }]));
        pingTimer = setInterval(() => socket?.send("PING"), 60_000);
      });
      socket.on("message", (raw) => {
        try {
          const frame = JSON.parse(raw.toString()) as {
            type: string;
            rejected?: unknown[];
            data?: unknown;
          };
          if (frame.type === "subscriptions") {
            if (frame.rejected?.length) send("error", { code: "subscription-failed", message: "Market-data subscription failed." });
            else send("status", { state: "connected" });
          } else if (frame.type === "message" && frame.data) {
            send("trade", publicTrade(frame.data));
          } else if (frame.type === "error") {
            send("error", { code: "upstream-error", message: "Market-data connection failed." });
          }
        } catch {
          send("error", { code: "invalid-frame", message: "Invalid market-data response." });
        }
      });
      socket.on("error", () => send("error", { code: "socket-error", message: "Market-data connection failed." }));
      socket.on("close", () => {
        send("status", { state: "disconnected" });
        finish();
      });
      request.signal.addEventListener("abort", finish, { once: true });
    },
    cancel() {
      finished = true;
      if (pingTimer) clearInterval(pingTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
