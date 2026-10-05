import "server-only";

export const TOSS_API_BASE = "https://openapi.tossinvest.com";

interface TokenState {
  value: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;
let tokenRequest: Promise<string> | null = null;

export function tossMode(): "demo" | "live" {
  const mode = process.env.TOSSINVEST_MODE || "demo";
  if (mode === "demo") return "demo";
  if (mode !== "live") throw new Error("Invalid Toss demo configuration.");
  const hasId = Boolean(process.env.TOSSINVEST_CLIENT_ID);
  const hasSecret = Boolean(process.env.TOSSINVEST_CLIENT_SECRET);
  if (!hasId || !hasSecret) {
    throw new Error("Live mode requires both server credentials.");
  }
  return "live";
}

export async function getTossAccessToken(): Promise<string> {
  if (tossMode() !== "live") throw new Error("Live mode is disabled.");
  if (tokenState && tokenState.expiresAt > Date.now() + 60_000) return tokenState.value;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const response = await fetch(`${TOSS_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TOSSINVEST_CLIENT_ID!,
        client_secret: process.env.TOSSINVEST_CLIENT_SECRET!,
      }),
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("Market-data authentication failed.");
    }
    tokenState = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return tokenState.value;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}
